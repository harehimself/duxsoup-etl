const Person = require("../models/person");

/**
 * Enrichment Gap Service
 *
 * Analyzes person records for missing fields and generates
 * prioritized revisit lists for DuxSoup re-scanning.
 */

// Field weights for gap scoring (sum to 100)
const GAP_FIELD_WEIGHTS = {
  email: 30,
  phone: 20,
  currentCompanyId: 15,
  roles: 15,
  education: 10,
  skills: 5,
  industry: 3,
  location: 2,
};

const GAP_FIELDS = Object.keys(GAP_FIELD_WEIGHTS);

// Seniority rank mappings for contact value scoring
const SENIORITY_RANK_SCORE = {
  8: 50, // Owner
  7: 45, // CXO
  6: 40, // SVP
  5: 35, // VP
  4: 30, // Managing Director
  3: 20, // Manager
  2: 10, // In Training
  1: 5, // Individual Contributor
};

/**
 * Get enrichment gap analysis dashboard.
 *
 * Returns per-field missing counts/percentages and seniority breakdown.
 *
 * @param {Object} options - Filter options
 * @param {string} [options.seniority] - Seniority tier filter
 * @param {number} [options.minRank] - Minimum seniority rank (1-8)
 * @param {string} [options.company] - Company name filter (regex)
 * @param {string} [options.companyId] - Company ID filter
 * @param {string[]} [options.fields] - Specific gap fields to report
 * @returns {Promise<Object>} Gap analysis results
 */
async function getEnrichmentGaps(options = {}) {
  const baseFilter = buildBaseFilter(options);
  const reportFields =
    options.fields && options.fields.length > 0
      ? options.fields.filter((f) => GAP_FIELDS.includes(f))
      : GAP_FIELDS;

  // Build aggregation pipeline for field gap counts
  const gapProjection = {};
  for (const field of reportFields) {
    if (field === "roles" || field === "education" || field === "skills") {
      // Array fields: missing if absent or empty
      gapProjection[`missing_${field}`] = {
        $cond: [
          {
            $or: [
              {
                $eq: [{ $ifNull: [`$snapshot.${field}`, null] }, null],
              },
              { $eq: [{ $size: { $ifNull: [`$snapshot.${field}`, []] } }, 0] },
            ],
          },
          1,
          0,
        ],
      };
    } else {
      // Scalar fields: missing if null or empty string
      gapProjection[`missing_${field}`] = {
        $cond: [
          {
            $or: [
              {
                $eq: [{ $ifNull: [`$snapshot.${field}`, null] }, null],
              },
              { $eq: [`$snapshot.${field}`, ""] },
            ],
          },
          1,
          0,
        ],
      };
    }
  }

  const [gapResult, totalCount, seniorityBreakdown] = await Promise.all([
    Person.aggregate([
      { $match: baseFilter },
      { $project: gapProjection },
      {
        $group: {
          _id: null,
          ...Object.fromEntries(
            reportFields.map((f) => [`${f}Count`, { $sum: `$missing_${f}` }]),
          ),
          total: { $sum: 1 },
        },
      },
    ]),
    Person.countDocuments(baseFilter),
    Person.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: "$snapshot.parsedSeniority",
          count: { $sum: 1 },
          missingEmail: {
            $sum: {
              $cond: [
                {
                  $or: [
                    {
                      $eq: [{ $ifNull: ["$snapshot.email", null] }, null],
                    },
                    { $eq: ["$snapshot.email", ""] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          missingPhone: {
            $sum: {
              $cond: [
                {
                  $or: [
                    {
                      $eq: [{ $ifNull: ["$snapshot.phone", null] }, null],
                    },
                    { $eq: ["$snapshot.phone", ""] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          missingRoles: {
            $sum: {
              $cond: [
                {
                  $eq: [{ $size: { $ifNull: ["$snapshot.roles", []] } }, 0],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]),
  ]);

  const gapData = gapResult[0] || { total: 0 };
  const total = gapData.total || totalCount;

  // Build field gaps array sorted by severity (highest missing % first)
  const fieldGaps = reportFields
    .map((field) => {
      const missingCount = gapData[`${field}Count`] || 0;
      return {
        field,
        weight: GAP_FIELD_WEIGHTS[field],
        missingCount,
        totalCount: total,
        missingPercent:
          total > 0 ? Math.round((missingCount / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.missingPercent - a.missingPercent);

  return {
    summary: {
      totalPeople: total,
      fieldsAnalyzed: reportFields.length,
      avgGapPercent:
        total > 0
          ? Math.round(
              (fieldGaps.reduce((sum, f) => sum + f.missingPercent, 0) /
                fieldGaps.length) *
                10,
            ) / 10
          : 0,
    },
    fieldGaps,
    seniorityBreakdown: seniorityBreakdown.map((tier) => ({
      seniority: tier._id || "Unknown",
      count: tier.count,
      missingEmail: tier.missingEmail,
      missingPhone: tier.missingPhone,
      missingRoles: tier.missingRoles,
    })),
  };
}

/**
 * Get prioritized revisit list of people with enrichment gaps.
 *
 * @param {Object} options - Filter options
 * @param {number} [options.limit=100] - Max results
 * @param {number} [options.minScore=0] - Minimum priority score
 * @param {string} [options.seniority] - Seniority tier filter
 * @param {number} [options.minRank] - Minimum seniority rank (1-8)
 * @param {string} [options.company] - Company name filter (regex)
 * @param {string} [options.companyId] - Company ID filter
 * @returns {Promise<Object>} Revisit list
 */
async function getRevisitList(options = {}) {
  const { limit = 100, minScore = 0 } = options;
  const baseFilter = buildBaseFilter(options);
  const now = new Date();

  const people = await Person.find(baseFilter)
    .select(
      "_id aliases snapshot.email snapshot.phone snapshot.currentCompanyId " +
        "snapshot.roles snapshot.education snapshot.skills snapshot.industry " +
        "snapshot.location snapshot.firstName snapshot.lastName snapshot.fullName " +
        "snapshot.currentTitle snapshot.currentCompany snapshot.connections " +
        "snapshot.parsedSeniority derived.highestSeniorityRank " +
        "meta.lastObservedAt",
    )
    .lean();

  const results = [];

  for (const person of people) {
    const gapScore = _calculateGapScore(person);
    if (gapScore === 0) continue;

    const contactValue = _calculateContactValue(person, now);
    const priorityScore = _calculatePriorityScore(gapScore, contactValue);

    if (priorityScore < minScore) continue;

    results.push({
      personId: person._id,
      name:
        (person.snapshot && person.snapshot.fullName) ||
        [
          person.snapshot && person.snapshot.firstName,
          person.snapshot && person.snapshot.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        "Unknown",
      currentTitle: (person.snapshot && person.snapshot.currentTitle) || "",
      currentCompany: (person.snapshot && person.snapshot.currentCompany) || "",
      profileUrl: _extractProfileUrl(person),
      gapScore,
      contactValue,
      priorityScore,
      missingFields: _getMissingFields(person),
      lastObservedAt:
        person.meta && person.meta.lastObservedAt
          ? person.meta.lastObservedAt
          : null,
    });
  }

  // Sort by priority descending
  results.sort((a, b) => b.priorityScore - a.priorityScore);

  return results.slice(0, limit);
}

/**
 * Calculate gap score based on missing fields (0-100).
 * Higher = more fields missing.
 */
function _calculateGapScore(person) {
  const snapshot = person.snapshot || {};
  let score = 0;

  for (const [field, weight] of Object.entries(GAP_FIELD_WEIGHTS)) {
    if (_isFieldMissing(snapshot, field)) {
      score += weight;
    }
  }

  return score;
}

/**
 * Calculate contact value score (0-100).
 * Seniority (0-50) + Recency (0-30) + Connections (0-20).
 */
function _calculateContactValue(person, now) {
  let score = 0;

  // Seniority component (0-50)
  const rank = (person.derived && person.derived.highestSeniorityRank) || 0;
  score += SENIORITY_RANK_SCORE[rank] || 0;

  // Recency component (0-30)
  const lastObserved = person.meta && person.meta.lastObservedAt;
  if (lastObserved) {
    const daysSince = (now - new Date(lastObserved)) / (1000 * 60 * 60 * 24);
    if (daysSince <= 7) score += 30;
    else if (daysSince <= 30) score += 25;
    else if (daysSince <= 90) score += 15;
    else if (daysSince <= 180) score += 5;
    // > 180 days: 0
  }

  // Connections component (0-20)
  const connections = (person.snapshot && person.snapshot.connections) || 0;
  if (connections >= 500) score += 20;
  else if (connections >= 200) score += 15;
  else if (connections >= 100) score += 10;
  else if (connections >= 50) score += 5;

  return score;
}

/**
 * Calculate combined priority score (0-200).
 */
function _calculatePriorityScore(gapScore, contactValue) {
  return Math.round(gapScore + contactValue);
}

/**
 * Get array of missing field names for a person.
 */
function _getMissingFields(person) {
  const snapshot = person.snapshot || {};
  return GAP_FIELDS.filter((field) => _isFieldMissing(snapshot, field));
}

/**
 * Extract best available profile URL from person aliases.
 * Priority: publicUrl > salesUrl > salesNavId (construct) > linkedInUsername (construct).
 */
function _extractProfileUrl(person) {
  const aliases = person.aliases || [];

  // Try publicUrl first
  const publicUrl = aliases.find((a) => a.type === "publicUrl");
  if (publicUrl) return publicUrl.value;

  // Try salesUrl
  const salesUrl = aliases.find((a) => a.type === "salesUrl");
  if (salesUrl) return salesUrl.value;

  // Try constructing from salesNavId
  const salesNavId = aliases.find((a) => a.type === "salesNavId");
  if (salesNavId) {
    return `https://www.linkedin.com/sales/lead/${salesNavId.value}`;
  }

  // Try constructing from linkedInUsername
  const username = aliases.find((a) => a.type === "linkedInUsername");
  if (username) {
    return `https://www.linkedin.com/in/${username.value}`;
  }

  return "";
}

/**
 * Check if a snapshot field is missing (null, empty string, or empty array).
 */
function _isFieldMissing(snapshot, field) {
  const value = snapshot[field];
  if (value == null) return true;
  if (value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Build base MongoDB filter from options.
 * Always excludes merged records.
 */
function buildBaseFilter(options) {
  const filter = { mergedInto: { $exists: false } };

  if (options.seniority) {
    filter["snapshot.parsedSeniority"] = options.seniority;
  }

  if (options.minRank) {
    filter["derived.highestSeniorityRank"] = { $gte: options.minRank };
  }

  if (options.company) {
    filter["snapshot.currentCompany"] = new RegExp(options.company, "i");
  }

  if (options.companyId) {
    filter["snapshot.currentCompanyId"] = options.companyId;
  }

  return filter;
}

module.exports = {
  getEnrichmentGaps,
  getRevisitList,
  GAP_FIELD_WEIGHTS,
  GAP_FIELDS,
  // Exported for testing
  _calculateGapScore,
  _calculateContactValue,
  _calculatePriorityScore,
  _getMissingFields,
  _extractProfileUrl,
  _isFieldMissing,
};
