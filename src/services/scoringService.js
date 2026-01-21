const Person = require('../models/person');
const { getRecentChanges } = require('./changeDetectionService');
const logger = require('../utils/logger');

/**
 * Lead Scoring Service
 *
 * Calculates lead scores and assigns segments for sales intelligence
 *
 * Scoring Logic (max 100 points):
 * - Seniority: VP/Director/Chief/Head (+30 points)
 * - Company: Fortune 500, tech giants (+25 points)
 * - Influence: 1000+ connections (+20), 500+ (+10)
 * - Data completeness: Has email (+15), has phone (+10)
 *
 * Segments:
 * - high_value: leadScore >= 70
 * - decision_maker: VP/Director/Chief titles
 * - warm_lead: Job change in last 30 days
 * - needs_enrichment: Missing email/phone
 * - standard: Everyone else
 */

// Fortune 500 and major tech companies (sample list)
const HIGH_VALUE_COMPANIES = new Set([
  'Google',
  'Microsoft',
  'Amazon',
  'Apple',
  'Meta',
  'Facebook',
  'Netflix',
  'Tesla',
  'Salesforce',
  'Oracle',
  'IBM',
  'Intel',
  'NVIDIA',
  'Adobe',
  'Cisco',
  'PayPal',
  'Uber',
  'Airbnb',
  'Stripe',
  'Shopify',
  'Twitter',
  'LinkedIn',
  'Snap',
  'Zoom',
  'Slack',
  'Atlassian',
  'ServiceNow',
  'Workday',
  'Square',
  'Coinbase',
  'SpaceX',
]);

/**
 * Calculate lead score for a person
 *
 * @param {Object} person - Person document or snapshot
 * @returns {Number} Lead score (0-100)
 */
function calculateLeadScore(person) {
  const snapshot = person.snapshot || person;
  let score = 0;

  // 1. Seniority (max 30 points)
  const seniorityScore = calculateSeniorityScore(snapshot.currentTitle);
  score += seniorityScore;

  // 2. Company (max 25 points)
  const companyScore = calculateCompanyScore(snapshot.currentCompany);
  score += companyScore;

  // 3. Influence/Connections (max 20 points)
  const influenceScore = calculateInfluenceScore(snapshot.connections);
  score += influenceScore;

  // 4. Data completeness (max 25 points)
  const completenessScore = calculateCompletenessScore(snapshot);
  score += completenessScore;

  // Ensure score is within bounds
  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate seniority score based on title
 *
 * @param {String} title - Job title
 * @returns {Number} Score (0-30)
 */
function calculateSeniorityScore(title) {
  if (!title) return 0;

  const titleLower = title.toLowerCase();

  // C-level (30 points)
  if (
    /\b(chief|ceo|cfo|cto|coo|cmo|cso|cio|cpo|cro)\b/i.test(title)
  ) {
    return 30;
  }

  // VP (25 points)
  if (/\b(vp|vice president|v\.p\.)\b/i.test(title)) {
    return 25;
  }

  // Director (20 points)
  if (/\b(director|dir\.)\b/i.test(title)) {
    return 20;
  }

  // Head/Lead (15 points)
  if (/\b(head|lead)\b/i.test(title)) {
    return 15;
  }

  // Manager (10 points)
  if (/\b(manager|mgr\.)\b/i.test(title)) {
    return 10;
  }

  // Senior (5 points)
  if (/\b(senior|sr\.)\b/i.test(title)) {
    return 5;
  }

  return 0;
}

/**
 * Calculate company score
 *
 * @param {String} company - Company name
 * @returns {Number} Score (0-25)
 */
function calculateCompanyScore(company) {
  if (!company) return 0;

  // Normalize company name (remove Inc., LLC, etc.)
  const normalized = company
    .replace(/\s+(Inc\.|LLC|Ltd\.|Corp\.|Corporation)$/i, '')
    .trim();

  // Check if high-value company
  if (HIGH_VALUE_COMPANIES.has(normalized)) {
    return 25;
  }

  // Check for tech company indicators
  const techKeywords = /\b(software|technology|cloud|saas|ai|analytics|data)\b/i;
  if (techKeywords.test(company)) {
    return 15;
  }

  return 0;
}

/**
 * Calculate influence score based on connections
 *
 * @param {Number} connections - Connection count
 * @returns {Number} Score (0-20)
 */
function calculateInfluenceScore(connections) {
  if (!connections || connections < 0) return 0;

  if (connections >= 1000) {
    return 20;
  } else if (connections >= 500) {
    return 10;
  } else if (connections >= 100) {
    return 5;
  }

  return 0;
}

/**
 * Calculate data completeness score
 *
 * @param {Object} snapshot - Person snapshot
 * @returns {Number} Score (0-25)
 */
function calculateCompletenessScore(snapshot) {
  let score = 0;

  // Has email (15 points)
  if (snapshot.email && snapshot.email.trim()) {
    score += 15;
  }

  // Has phone (10 points)
  if (snapshot.phone && snapshot.phone.trim()) {
    score += 10;
  }

  return score;
}

/**
 * Determine segment for a person
 *
 * @param {Object} person - Person document
 * @param {Array} recentChanges - Recent job changes for this person (optional)
 * @returns {String} Segment name
 */
function determineSegment(person, recentChanges = []) {
  const snapshot = person.snapshot || person;
  const score = person.derived?.leadScore || calculateLeadScore(person);

  // High value (leadScore >= 70)
  if (score >= 70) {
    return 'high_value';
  }

  // Decision maker (VP/Director/C-level)
  const title = snapshot.currentTitle || '';
  if (/\b(vp|vice president|director|chief|ceo|cfo|cto|coo|cmo)\b/i.test(title)) {
    return 'decision_maker';
  }

  // Warm lead (job change in last 30 days)
  if (recentChanges && recentChanges.length > 0) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const hasRecentChange = recentChanges.some(
      (change) => new Date(change.timestamp) >= thirtyDaysAgo,
    );

    if (hasRecentChange) {
      return 'warm_lead';
    }
  }

  // Needs enrichment (missing email or phone)
  if (!snapshot.email || !snapshot.phone) {
    return 'needs_enrichment';
  }

  // Standard
  return 'standard';
}

/**
 * Update lead score and segment for a person
 *
 * @param {Object} person - Person document (Mongoose model instance)
 * @param {Array} recentChanges - Recent job changes (optional)
 * @returns {Object} Updated person
 */
async function updatePersonScore(person, recentChanges = []) {
  const score = calculateLeadScore(person);
  const segment = determineSegment(person, recentChanges);

  if (!person.derived) {
    person.derived = {};
  }

  person.derived.leadScore = score;
  person.derived.segment = segment;
  person.derived.scoreUpdatedAt = new Date();

  return person;
}

/**
 * Recalculate scores for all people (batch operation)
 *
 * @param {Object} options - Options
 * @param {Number} options.batchSize - Batch size (default: 100)
 * @param {Number} options.limit - Max people to process (optional)
 * @returns {Promise<Object>} Stats
 */
async function recalculateAllScores(options = {}) {
  const { batchSize = 100, limit } = options;

  logger.info('Starting lead score recalculation', { batchSize, limit });

  let processedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  // Get recent changes (last 30 days) for warm lead detection
  const recentChanges = await getRecentChanges({ days: 30, limit: 10000 });
  const changesByPerson = {};

  for (const change of recentChanges) {
    if (!changesByPerson[change.person_id]) {
      changesByPerson[change.person_id] = [];
    }
    changesByPerson[change.person_id].push(change);
  }

  // Process in batches
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch batch
    const query = Person.find().skip(skip).limit(batchSize);

    if (limit && skip >= limit) {
      break;
    }

    const people = await query.exec();

    if (people.length === 0) {
      hasMore = false;
      break;
    }

    // Update scores
    for (const person of people) {
      try {
        const personChanges = changesByPerson[person._id] || [];
        await updatePersonScore(person, personChanges);
        await person.save();

        processedCount++;
        updatedCount++;

        if (processedCount % 100 === 0) {
          logger.info('Score recalculation progress', {
            processed: processedCount,
            updated: updatedCount,
            errors: errorCount,
          });
        }
      } catch (err) {
        logger.error('Failed to update person score', {
          person_id: person._id,
          error: err.message,
        });
        errorCount++;
      }
    }

    skip += batchSize;
  }

  logger.info('Lead score recalculation complete', {
    processed: processedCount,
    updated: updatedCount,
    errors: errorCount,
  });

  return {
    processed: processedCount,
    updated: updatedCount,
    errors: errorCount,
  };
}

/**
 * Get people by segment
 *
 * @param {String} segment - Segment name
 * @param {Number} limit - Result limit (default: 100)
 * @returns {Promise<Array>} People in segment
 */
async function getPeopleBySegment(segment, limit = 100) {
  const query = {};

  if (segment === 'high_value') {
    query['derived.leadScore'] = { $gte: 70 };
  } else if (segment === 'decision_maker') {
    query['snapshot.currentTitle'] = {
      $regex: /\b(vp|vice president|director|chief|ceo|cfo|cto|coo|cmo)\b/i,
    };
  } else if (segment === 'warm_lead') {
    query['derived.segment'] = 'warm_lead';
  } else if (segment === 'needs_enrichment') {
    query.$or = [
      { 'snapshot.email': { $exists: false } },
      { 'snapshot.email': null },
      { 'snapshot.email': '' },
      { 'snapshot.phone': { $exists: false } },
      { 'snapshot.phone': null },
      { 'snapshot.phone': '' },
    ];
  } else {
    query['derived.segment'] = segment;
  }

  const people = await Person.find(query)
    .sort({ 'derived.leadScore': -1 })
    .limit(limit)
    .lean()
    .exec();

  return people;
}

module.exports = {
  calculateLeadScore,
  determineSegment,
  updatePersonScore,
  recalculateAllScores,
  getPeopleBySegment,
};
