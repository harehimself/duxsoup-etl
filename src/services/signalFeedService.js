const Change = require("../models/change");
const Person = require("../models/person");
const {
  SIGNAL_DEFAULT_DAYS,
  SIGNAL_MAX_DAYS,
  SIGNAL_DEFAULT_LIMIT,
  SIGNAL_MAX_LIMIT,
  SIGNAL_NEW_DM_MIN_RANK,
} = require("../constants/limits");

/**
 * Signal Feed Service
 *
 * Queries Change and Person collections to surface time-sensitive
 * engagement signals: new roles, promotions, lateral moves, and
 * newly observed decision-makers. Ranked by a composite score
 * (seniority + recency + signal type).
 */

const VALID_SIGNAL_TYPES = [
  "new_role",
  "promotion",
  "lateral_move",
  "new_decision_maker",
];

// Weights for composite ranking score (0-100)
const WEIGHT_SENIORITY = 0.4;
const WEIGHT_RECENCY = 0.35;
const WEIGHT_SIGNAL_TYPE = 0.25;

// Signal type base scores (out of 100)
const SIGNAL_TYPE_SCORES = {
  new_role: 70,
  promotion: 85,
  lateral_move: 75,
  new_decision_maker: 60,
};

// Max seniority rank for normalization
const MAX_SENIORITY_RANK = 8;

/**
 * Calculate composite ranking score (0-100).
 *
 * @param {number|null} seniorityRank - 1-8 scale (null treated as 3)
 * @param {Date} timestamp - When the signal occurred
 * @param {string} signalType - One of VALID_SIGNAL_TYPES
 * @param {Date} now - Current time (for recency calc)
 * @param {number} windowDays - Lookback window size
 * @returns {number} Score 0-100
 */
function calculateScore(seniorityRank, timestamp, signalType, now, windowDays) {
  // Seniority: normalize to 0-100 (higher rank = higher score)
  const rank = seniorityRank != null ? seniorityRank : 3;
  const seniorityScore = (rank / MAX_SENIORITY_RANK) * 100;

  // Recency: linear decay from 100 (today) to 0 (windowDays ago)
  const ageMs = now.getTime() - new Date(timestamp).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const recencyScore = Math.max(0, (1 - ageMs / windowMs) * 100);

  // Signal type: fixed base score
  const typeScore = SIGNAL_TYPE_SCORES[signalType] || 50;

  const composite =
    seniorityScore * WEIGHT_SENIORITY +
    recencyScore * WEIGHT_RECENCY +
    typeScore * WEIGHT_SIGNAL_TYPE;

  return Math.round(composite * 10) / 10;
}

/**
 * Map score to priority tier.
 * @param {number} score
 * @returns {string} "high" | "medium" | "low"
 */
function scoreToPriority(score) {
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

/**
 * Calculate days since a given date.
 * @param {Date} date
 * @param {Date} now
 * @returns {number}
 */
function daysSince(date, now) {
  return Math.floor(
    (now.getTime() - new Date(date).getTime()) / (24 * 60 * 60 * 1000),
  );
}

/**
 * Build human-readable action context string.
 *
 * @param {string} signalType
 * @param {Object} data - Signal data (change record or person)
 * @param {Date} now
 * @returns {string}
 */
function buildActionContext(signalType, data, now) {
  switch (signalType) {
    case "new_role": {
      const company = data.to || data.personSnapshot?.currentCompany || "";
      const title = data.toTitle || "";
      const days = daysSince(data.timestamp, now);
      const prev = data.from || "";
      const tenure = data.tenureDaysAtPreviousRole;
      const tenureStr =
        tenure != null
          ? ` for ${Math.round((tenure / 365) * 10) / 10} years`
          : "";
      const titlePart = title ? `${title} at ${company}` : company;
      return `New ${titlePart} (${days} days into role) — in buying window.${prev ? ` Previously at ${prev}${tenureStr}.` : ""}`;
    }

    case "promotion": {
      const fromTitle = data.fromTitle || data.from || "";
      const toTitle = data.toTitle || data.to || "";
      const company = data.company || data.personSnapshot?.currentCompany || "";
      return `Promoted from ${fromTitle} to ${toTitle} at ${company} — budget authority may have shifted.`;
    }

    case "lateral_move": {
      const title = data.toTitle || data.seniority || "";
      const fromCompany = data.from || "";
      const toCompany = data.to || "";
      const toTitle = data.toTitle || "";
      const titlePart = title ? ` as ${toTitle}` : "";
      return `${title || "Lateral"} lateral move from ${fromCompany} to ${toCompany}${titlePart} — new relationship opportunity at target account.`;
    }

    case "new_decision_maker": {
      const seniority = data.derived?.highestSeniority || "";
      const title = data.snapshot?.currentTitle || "";
      const company = data.snapshot?.currentCompany || "";
      const level = seniority ? `${seniority}-level ` : "";
      return `Newly observed ${level}decision maker: ${title} at ${company}.`;
    }

    default:
      return "";
  }
}

/**
 * Deduplicate signals: when the same person has both new_role + lateral_move
 * at the same timestamp, keep lateral_move (more specific).
 *
 * @param {Array} signals
 * @returns {Array} Deduplicated signals
 */
function deduplicateSignals(signals) {
  const grouped = new Map();

  for (const signal of signals) {
    const key = `${signal.personId}:${new Date(signal.timestamp).getTime()}`;
    if (!grouped.has(key)) {
      grouped.set(key, [signal]);
    } else {
      grouped.get(key).push(signal);
    }
  }

  const result = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const hasNewRole = group.some((s) => s.type === "new_role");
    const hasLateralMove = group.some((s) => s.type === "lateral_move");

    if (hasNewRole && hasLateralMove) {
      // Keep lateral_move (more specific), drop new_role
      for (const s of group) {
        if (s.type !== "new_role") {
          result.push(s);
        }
      }
    } else {
      // Keep all (different events)
      result.push(...group);
    }
  }

  return result;
}

/**
 * Query and build signals feed.
 *
 * @param {Object} options
 * @param {string[]} [options.types] - Signal types to include (default: all)
 * @param {number} [options.minRank] - Minimum seniority rank (1-8)
 * @param {string} [options.company] - Company name filter (regex)
 * @param {string} [options.companyId] - Company ID filter
 * @param {number} [options.days] - Lookback window
 * @param {number} [options.limit] - Max results
 * @param {number} [options.offset] - Pagination offset
 * @returns {Promise<{signals: Array, total: number, limit: number, offset: number}>}
 */
async function getSignals(options = {}) {
  const types =
    options.types && options.types.length > 0
      ? options.types.filter((t) => VALID_SIGNAL_TYPES.includes(t))
      : VALID_SIGNAL_TYPES;

  const minRank = Math.max(options.minRank || 1, 1);
  const days = Math.min(options.days || SIGNAL_DEFAULT_DAYS, SIGNAL_MAX_DAYS);
  const limit = Math.min(
    options.limit || SIGNAL_DEFAULT_LIMIT,
    SIGNAL_MAX_LIMIT,
  );
  const offset = options.offset || 0;
  const company = options.company || null;
  const companyId = options.companyId || null;

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Determine which Change-based types and whether new_decision_maker is requested
  const changeTypes = [];
  if (types.includes("new_role")) changeTypes.push("company_change");
  if (types.includes("promotion")) changeTypes.push("promotion");
  if (types.includes("lateral_move")) changeTypes.push("lateral_move");
  const wantDecisionMakers = types.includes("new_decision_maker");

  // Build parallel queries
  const queries = [];

  // Query 1: Change-based signals (new_role, promotion, lateral_move)
  if (changeTypes.length > 0) {
    const changeFilter = {
      type: { $in: changeTypes },
      timestamp: { $gte: cutoff },
    };

    // seniorityRank filtering: include null to avoid dropping unclassified
    if (minRank > 1) {
      changeFilter.$or = [
        { seniorityRank: { $gte: minRank } },
        { seniorityRank: null },
      ];
    }

    // Company filtering
    if (companyId) {
      // For company_change and lateral_move, filter on toCompanyId
      // Promotions don't have toCompanyId — accept the limitation
      changeFilter.$and = changeFilter.$and || [];
      changeFilter.$and.push({
        $or: [{ toCompanyId: companyId }, { fromCompanyId: companyId }],
      });
    } else if (company) {
      changeFilter.$and = changeFilter.$and || [];
      changeFilter.$and.push({
        $or: [
          { to: new RegExp(company, "i") },
          { from: new RegExp(company, "i") },
          { company: new RegExp(company, "i") },
        ],
      });
    }

    // For new_role, restrict to recentJobChange = true (90-day buying window)
    // We'll filter this in JS since we query multiple change types at once
    queries.push(
      Change.find(changeFilter)
        .sort({ timestamp: -1 })
        .select(
          "type person_id personSnapshot from to company fromCompanyId toCompanyId fromTitle toTitle seniority seniorityRank tenureDaysAtPreviousRole recentJobChange timestamp",
        )
        .lean(),
    );
  } else {
    queries.push(Promise.resolve([]));
  }

  // Query 2: New decision makers (Person-based)
  if (wantDecisionMakers) {
    const dmFilter = {
      "derived.highestSeniorityRank": {
        $gte: Math.max(minRank, SIGNAL_NEW_DM_MIN_RANK),
      },
      createdAt: { $gte: cutoff },
      mergedInto: null,
    };

    if (companyId) {
      dmFilter["snapshot.currentCompanyId"] = companyId;
    } else if (company) {
      dmFilter["snapshot.currentCompany"] = new RegExp(company, "i");
    }

    queries.push(
      Person.find(dmFilter)
        .sort({ createdAt: -1 })
        .select(
          "snapshot.fullName snapshot.currentTitle snapshot.currentCompany snapshot.currentCompanyId derived.highestSeniority derived.highestSeniorityRank createdAt",
        )
        .lean(),
    );
  } else {
    queries.push(Promise.resolve([]));
  }

  const [changeResults, dmResults] = await Promise.all(queries);

  // Transform change records into signals
  let signals = [];

  for (const change of changeResults) {
    let signalType;
    if (change.type === "company_change") {
      // Only include as new_role if recentJobChange is true
      if (!change.recentJobChange) continue;
      signalType = "new_role";
    } else if (change.type === "promotion") {
      signalType = "promotion";
    } else if (change.type === "lateral_move") {
      signalType = "lateral_move";
    } else {
      continue;
    }

    // Skip if this type wasn't requested
    if (!types.includes(signalType)) continue;

    const score = calculateScore(
      change.seniorityRank,
      change.timestamp,
      signalType,
      now,
      days,
    );

    signals.push({
      type: signalType,
      personId: change.person_id,
      personName: change.personSnapshot?.fullName || null,
      title: change.toTitle || change.fromTitle || null,
      company: change.to || change.company || null,
      companyId: change.toCompanyId || null,
      seniority: change.seniority || null,
      seniorityRank: change.seniorityRank || null,
      score,
      priority: scoreToPriority(score),
      timestamp: change.timestamp,
      actionContext: buildActionContext(signalType, change, now),
      _sourceId: change._id,
    });
  }

  // Transform new decision makers into signals
  for (const person of dmResults) {
    const score = calculateScore(
      person.derived?.highestSeniorityRank,
      person.createdAt,
      "new_decision_maker",
      now,
      days,
    );

    signals.push({
      type: "new_decision_maker",
      personId: person._id,
      personName: person.snapshot?.fullName || null,
      title: person.snapshot?.currentTitle || null,
      company: person.snapshot?.currentCompany || null,
      companyId: person.snapshot?.currentCompanyId || null,
      seniority: person.derived?.highestSeniority || null,
      seniorityRank: person.derived?.highestSeniorityRank || null,
      score,
      priority: scoreToPriority(score),
      timestamp: person.createdAt,
      actionContext: buildActionContext("new_decision_maker", person, now),
      _sourceId: person._id,
    });
  }

  // Deduplicate
  signals = deduplicateSignals(signals);

  // Sort by score descending, timestamp tiebreak (newer first)
  signals.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const total = signals.length;

  // Paginate
  const paginated = signals.slice(offset, offset + limit);

  return {
    signals: paginated,
    total,
    limit,
    offset,
  };
}

module.exports = {
  getSignals,
  // Exported for testing
  _calculateScore: calculateScore,
  _scoreToPriority: scoreToPriority,
  _buildActionContext: buildActionContext,
  _deduplicateSignals: deduplicateSignals,
  _daysSince: daysSince,
  VALID_SIGNAL_TYPES,
};
