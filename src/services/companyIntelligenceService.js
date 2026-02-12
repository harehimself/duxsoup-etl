const Person = require("../models/person");
const Company = require("../models/company");
const Change = require("../models/change");

/**
 * Company Intelligence Service
 *
 * Aggregates all people linked to a company into org-level insights:
 * headcount by seniority/department, decision makers, tenure,
 * hiring velocity, geography, and recent hires/departures.
 */

const DECISION_MAKER_MIN_RANK = 5; // VP and above
const RECENT_HIRES_MONTHS = 6;
const MAX_DECISION_MAKERS = 10;
const MAX_RECENT_CHANGES = 20;
const MAX_GEOGRAPHY = 20;

/**
 * Calculate median from an array of numbers.
 * @param {number[]} values - Sorted or unsorted numbers
 * @returns {number|null} Median value or null if empty
 */
function calculateMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Determine hiring velocity trend by comparing recent 3 months vs earlier 3 months.
 * @param {Array<{year: number, month: number, count: number}>} monthly - Monthly counts
 * @returns {string} "increasing", "decreasing", or "stable"
 */
function determineTrend(monthly) {
  if (monthly.length < 2) return "stable";

  // Split into recent half and earlier half
  const midpoint = Math.ceil(monthly.length / 2);
  const earlier = monthly.slice(0, midpoint);
  const recent = monthly.slice(midpoint);

  const earlierAvg =
    earlier.reduce((sum, m) => sum + m.count, 0) / earlier.length;
  const recentAvg = recent.reduce((sum, m) => sum + m.count, 0) / recent.length;

  if (earlierAvg === 0 && recentAvg === 0) return "stable";
  if (earlierAvg === 0) return "increasing";

  const changeRate = (recentAvg - earlierAvg) / earlierAvg;
  if (changeRate > 0.15) return "increasing";
  if (changeRate < -0.15) return "decreasing";
  return "stable";
}

/**
 * Get company intelligence rollup for a given company ID.
 *
 * @param {string} companyId - LinkedIn numeric company ID
 * @returns {Promise<Object|null>} Intelligence data or null if no people linked
 */
async function getCompanyIntelligence(companyId) {
  // Early exit: check if any people are linked to this company
  const peopleCount = await Person.countDocuments({
    "snapshot.currentCompanyId": companyId,
    mergedInto: null,
  });

  if (peopleCount === 0) {
    return null;
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - RECENT_HIRES_MONTHS);

  const baseFilter = {
    "snapshot.currentCompanyId": companyId,
    mergedInto: null,
  };

  // Run all queries in parallel
  const [
    companyDoc,
    seniorityDistribution,
    departmentDistribution,
    decisionMakers,
    tenureData,
    geographyData,
    recentHires,
    recentDepartures,
    hiringVelocity,
  ] = await Promise.all([
    // 1. Company document
    Company.findById(companyId).lean(),

    // 2. Seniority distribution
    Person.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: { $ifNull: ["$snapshot.parsedSeniority", "Unknown"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // 3. Department distribution
    Person.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: { $ifNull: ["$snapshot.parsedDepartment", "Unknown"] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // 4. Decision makers (VP+)
    Person.find({
      ...baseFilter,
      "derived.highestSeniorityRank": { $gte: DECISION_MAKER_MIN_RANK },
    })
      .sort({ "derived.highestSeniorityRank": -1 })
      .limit(MAX_DECISION_MAKERS)
      .select(
        "snapshot.fullName snapshot.currentTitle snapshot.parsedSeniority snapshot.email snapshot.city meta.lastObservedAt",
      )
      .lean(),

    // 5. Tenure statistics
    Person.aggregate([
      {
        $match: {
          ...baseFilter,
          "derived.yearsAtCurrentCompany": { $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          avgYears: { $avg: "$derived.yearsAtCurrentCompany" },
          values: { $push: "$derived.yearsAtCurrentCompany" },
          withData: { $sum: 1 },
        },
      },
    ]),

    // 6. Geography (top cities/countries)
    Person.aggregate([
      {
        $match: {
          ...baseFilter,
          $or: [
            { "snapshot.city": { $ne: null } },
            { "snapshot.country": { $ne: null } },
          ],
        },
      },
      {
        $group: {
          _id: {
            city: { $ifNull: ["$snapshot.city", "Unknown"] },
            country: { $ifNull: ["$snapshot.country", "Unknown"] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: MAX_GEOGRAPHY },
    ]),

    // 7. Recent hires (company_change TO this company)
    Change.find({
      toCompanyId: companyId,
      type: "company_change",
      timestamp: { $gte: sixMonthsAgo },
    })
      .sort({ timestamp: -1 })
      .limit(MAX_RECENT_CHANGES)
      .select(
        "person_id personSnapshot.fullName toTitle seniority timestamp from",
      )
      .lean(),

    // 8. Recent departures (company_change FROM this company)
    Change.find({
      fromCompanyId: companyId,
      type: "company_change",
      timestamp: { $gte: sixMonthsAgo },
    })
      .sort({ timestamp: -1 })
      .limit(MAX_RECENT_CHANGES)
      .select(
        "person_id personSnapshot.fullName fromTitle seniority timestamp to",
      )
      .lean(),

    // 9. Hiring velocity (new people observed per month, last 6 months)
    Person.aggregate([
      {
        $match: {
          ...baseFilter,
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
  ]);

  // Build company summary
  const company = companyDoc
    ? {
        _id: companyDoc._id,
        name: companyDoc.snapshot?.name || null,
        industry: companyDoc.snapshot?.industry || null,
        location: companyDoc.snapshot?.location || null,
        website: companyDoc.snapshot?.website || null,
      }
    : {
        _id: companyId,
        name: null,
        industry: null,
        location: null,
        website: null,
      };

  // Build seniority breakdown with percentages
  const bySeniority = seniorityDistribution.map((s) => ({
    tier: s._id,
    count: s.count,
    percentage: Math.round((s.count / peopleCount) * 1000) / 10,
  }));

  // Build department breakdown with percentages
  const byDepartment = departmentDistribution.map((d) => ({
    department: d._id,
    count: d.count,
    percentage: Math.round((d.count / peopleCount) * 1000) / 10,
  }));

  // Format decision makers
  const formattedDecisionMakers = decisionMakers.map((p) => ({
    personId: p._id,
    fullName: p.snapshot?.fullName || null,
    title: p.snapshot?.currentTitle || null,
    seniority: p.snapshot?.parsedSeniority || null,
    email: p.snapshot?.email || null,
    city: p.snapshot?.city || null,
    lastObservedAt: p.meta?.lastObservedAt || null,
  }));

  // Compute tenure stats
  const tenureResult = tenureData[0] || null;
  const tenure = {
    avgYears: tenureResult ? Math.round(tenureResult.avgYears * 10) / 10 : null,
    medianYears: tenureResult
      ? Math.round(calculateMedian(tenureResult.values) * 10) / 10
      : null,
    withData: tenureResult ? tenureResult.withData : 0,
  };

  // Format geography
  const geography = geographyData.map((g) => ({
    city: g._id.city,
    country: g._id.country,
    count: g.count,
  }));

  // Format recent hires
  const formattedHires = recentHires.map((h) => ({
    personId: h.person_id,
    fullName: h.personSnapshot?.fullName || null,
    title: h.toTitle || null,
    from: h.from || null,
    seniority: h.seniority || null,
    timestamp: h.timestamp,
  }));

  // Format recent departures
  const formattedDepartures = recentDepartures.map((d) => ({
    personId: d.person_id,
    fullName: d.personSnapshot?.fullName || null,
    title: d.fromTitle || null,
    to: d.to || null,
    seniority: d.seniority || null,
    timestamp: d.timestamp,
  }));

  // Compute hiring velocity
  const monthlyNewPeople = hiringVelocity.map((v) => ({
    year: v._id.year,
    month: v._id.month,
    count: v.count,
  }));

  const totalNewPeople = monthlyNewPeople.reduce((sum, m) => sum + m.count, 0);
  const monthCount = monthlyNewPeople.length || 1;
  const avgPerMonth = Math.round((totalNewPeople / monthCount) * 10) / 10;

  return {
    company,
    headcount: {
      total: peopleCount,
      bySeniority,
      byDepartment,
    },
    decisionMakers: formattedDecisionMakers,
    recentHires: formattedHires,
    recentDepartures: formattedDepartures,
    tenure,
    hiringVelocity: {
      monthlyNewPeople,
      avgPerMonth,
      trend: determineTrend(monthlyNewPeople),
    },
    geography,
  };
}

module.exports = {
  getCompanyIntelligence,
  // Exported for testing
  _calculateMedian: calculateMedian,
  _determineTrend: determineTrend,
};
