const Change = require('../models/change');
const logger = require('../utils/logger');
const { sendAlertIfNeeded } = require('./alertService');

/**
 * Change Detection Service
 *
 * Detects significant changes in person profiles:
 * - Company changes (job switches)
 * - Promotions (title upgrades at same company)
 * - Title changes
 */

/**
 * Detect changes between old and new person snapshots
 *
 * @param {Object} person - Person document
 * @param {Object} oldSnapshot - Previous snapshot state
 * @param {Object} newSnapshot - New snapshot state
 * @param {String} observationId - ID of observation that triggered update
 * @returns {Promise<Array>} Array of created change records
 */
async function detectChanges(person, oldSnapshot, newSnapshot, observationId) {
  const changes = [];

  // Skip if no old snapshot (first observation)
  if (!oldSnapshot) {
    return changes;
  }

  // Detect company change
  const companyChange = detectCompanyChange(oldSnapshot, newSnapshot);
  if (companyChange) {
    try {
      const change = await recordChange({
        type: 'company_change',
        person_id: person._id,
        personSnapshot: buildPersonSnapshot(person, newSnapshot),
        from: companyChange.from,
        to: companyChange.to,
        observationId,
      });

      if (change) {
        changes.push(change);
        logger.info('Company change detected', {
          person_id: person._id,
          fullName: newSnapshot.fullName,
          from: companyChange.from,
          to: companyChange.to,
        });
      }
    } catch (err) {
      // Ignore duplicate errors (change already recorded)
      if (err.code !== 11000) {
        logger.error('Failed to record company change', {
          person_id: person._id,
          error: err.message,
        });
      }
    }
  }

  // Detect promotion (title change at same company)
  const promotion = detectPromotion(oldSnapshot, newSnapshot);
  if (promotion) {
    try {
      const change = await recordChange({
        type: 'promotion',
        person_id: person._id,
        personSnapshot: buildPersonSnapshot(person, newSnapshot),
        from: promotion.from,
        to: promotion.to,
        company: promotion.company,
        observationId,
      });

      if (change) {
        changes.push(change);
        logger.info('Promotion detected', {
          person_id: person._id,
          fullName: newSnapshot.fullName,
          company: promotion.company,
          from: promotion.from,
          to: promotion.to,
        });
      }
    } catch (err) {
      if (err.code !== 11000) {
        logger.error('Failed to record promotion', {
          person_id: person._id,
          error: err.message,
        });
      }
    }
  }

  // Detect title change (different from promotion)
  const titleChange = detectTitleChange(oldSnapshot, newSnapshot);
  if (titleChange && !promotion) {
    // Only record if not already a promotion
    try {
      const change = await recordChange({
        type: 'title_change',
        person_id: person._id,
        personSnapshot: buildPersonSnapshot(person, newSnapshot),
        from: titleChange.from,
        to: titleChange.to,
        observationId,
      });

      if (change) {
        changes.push(change);
        logger.info('Title change detected', {
          person_id: person._id,
          fullName: newSnapshot.fullName,
          from: titleChange.from,
          to: titleChange.to,
        });
      }
    } catch (err) {
      if (err.code !== 11000) {
        logger.error('Failed to record title change', {
          person_id: person._id,
          error: err.message,
        });
      }
    }
  }

  return changes;
}

/**
 * Detect company change
 *
 * @param {Object} oldSnapshot - Old snapshot
 * @param {Object} newSnapshot - New snapshot
 * @returns {Object|null} Change details or null
 */
function detectCompanyChange(oldSnapshot, newSnapshot) {
  const oldCompany = oldSnapshot.currentCompany;
  const newCompany = newSnapshot.currentCompany;

  // Skip if either company is missing
  if (!oldCompany || !newCompany) {
    return null;
  }

  // Normalize company names (case-insensitive, trim whitespace)
  const normalizedOld = normalizeString(oldCompany);
  const normalizedNew = normalizeString(newCompany);

  // Check if companies are different
  if (normalizedOld !== normalizedNew) {
    return {
      from: oldCompany,
      to: newCompany,
    };
  }

  return null;
}

/**
 * Detect promotion (title change at same company)
 *
 * @param {Object} oldSnapshot - Old snapshot
 * @param {Object} newSnapshot - New snapshot
 * @returns {Object|null} Promotion details or null
 */
function detectPromotion(oldSnapshot, newSnapshot) {
  const oldTitle = oldSnapshot.currentTitle;
  const newTitle = newSnapshot.currentTitle;
  const oldCompany = oldSnapshot.currentCompany;
  const newCompany = newSnapshot.currentCompany;

  // Skip if missing data
  if (!oldTitle || !newTitle || !oldCompany || !newCompany) {
    return null;
  }

  // Companies must be the same
  const normalizedOldCompany = normalizeString(oldCompany);
  const normalizedNewCompany = normalizeString(newCompany);

  if (normalizedOldCompany !== normalizedNewCompany) {
    return null;
  }

  // Titles must be different
  const normalizedOldTitle = normalizeString(oldTitle);
  const normalizedNewTitle = normalizeString(newTitle);

  if (normalizedOldTitle === normalizedNewTitle) {
    return null;
  }

  // Check if new title is a promotion (contains seniority keywords)
  const isPromotion = detectSeniorityUpgrade(oldTitle, newTitle);

  if (isPromotion) {
    return {
      from: oldTitle,
      to: newTitle,
      company: newCompany,
    };
  }

  return null;
}

/**
 * Detect title change (different title, not necessarily a promotion)
 *
 * @param {Object} oldSnapshot - Old snapshot
 * @param {Object} newSnapshot - New snapshot
 * @returns {Object|null} Title change details or null
 */
function detectTitleChange(oldSnapshot, newSnapshot) {
  const oldTitle = oldSnapshot.currentTitle;
  const newTitle = newSnapshot.currentTitle;

  // Skip if missing data
  if (!oldTitle || !newTitle) {
    return null;
  }

  // Titles must be different
  const normalizedOld = normalizeString(oldTitle);
  const normalizedNew = normalizeString(newTitle);

  if (normalizedOld !== normalizedNew) {
    return {
      from: oldTitle,
      to: newTitle,
    };
  }

  return null;
}

/**
 * Detect if title change is a seniority upgrade
 *
 * @param {String} oldTitle - Old title
 * @param {String} newTitle - New title
 * @returns {Boolean} True if promotion
 */
function detectSeniorityUpgrade(oldTitle, newTitle) {
  // Seniority levels (higher index = more senior)
  const seniorityLevels = [
    /^(Junior|Jr\.|Associate|Entry)/i,
    /^(Engineer|Developer|Analyst|Designer|Specialist|Coordinator)/i, // No prefix = mid-level
    /^(Senior|Sr\.|Lead)/i,
    /^(Staff|Principal|Architect)/i,
    /^(Manager|Mgr\.)/i,
    /^(Senior Manager|Sr\. Manager)/i,
    /^(Director|Dir\.)/i,
    /^(Senior Director|Sr\. Director)/i,
    /^(VP|Vice President|V\.P\.)/i,
    /^(SVP|Senior VP|Senior Vice President)/i,
    /^(EVP|Executive VP|Executive Vice President)/i,
    /^(Chief|CEO|CFO|CTO|COO|CMO|CSO|CIO|CPO|CRO)/i,
  ];

  // Find seniority level for each title
  const oldLevel = seniorityLevels.findIndex((pattern) => pattern.test(oldTitle));
  const newLevel = seniorityLevels.findIndex((pattern) => pattern.test(newTitle));

  // If both found and new level is higher, it's a promotion
  if (oldLevel !== -1 && newLevel !== -1 && newLevel > oldLevel) {
    return true;
  }

  // Check for specific promotion keywords in new title
  const promotionKeywords = /promoted|upgraded|advanced/i;
  if (promotionKeywords.test(newTitle)) {
    return true;
  }

  return false;
}

/**
 * Record a change in the database
 *
 * @param {Object} changeData - Change data
 * @returns {Promise<Object>} Created change record
 */
async function recordChange(changeData) {
  const change = await Change.create({
    type: changeData.type,
    person_id: changeData.person_id,
    personSnapshot: changeData.personSnapshot,
    from: changeData.from,
    to: changeData.to,
    company: changeData.company,
    timestamp: new Date(),
    notified: false,
  });

  // Send Slack alert if needed (async, don't wait)
  sendAlertIfNeeded(change).catch((err) => {
    logger.error('Failed to send alert for change', {
      change_id: change._id,
      error: err.message,
    });
  });

  return change;
}

/**
 * Build person snapshot for change record
 *
 * @param {Object} person - Person document
 * @param {Object} snapshot - Current snapshot
 * @returns {Object} Person snapshot
 */
function buildPersonSnapshot(person, snapshot) {
  return {
    fullName: snapshot.fullName,
    currentTitle: snapshot.currentTitle,
    currentCompany: snapshot.currentCompany,
    connections: snapshot.connections,
    city: snapshot.city,
    state: snapshot.state,
    country: snapshot.country,
  };
}

/**
 * Normalize string for comparison
 *
 * @param {String} str - String to normalize
 * @returns {String} Normalized string
 */
function normalizeString(str) {
  if (!str) return '';
  return str.trim().toLowerCase();
}

/**
 * Get recent changes
 *
 * @param {Object} options - Query options
 * @param {String} options.type - Change type filter
 * @param {Number} options.days - Days to look back (default: 30)
 * @param {Number} options.limit - Result limit (default: 100)
 * @returns {Promise<Array>} Change records
 */
async function getRecentChanges(options = {}) {
  const { type, days = 30, limit = 100 } = options;

  const query = {};

  // Filter by type
  if (type) {
    query.type = type;
  }

  // Filter by date range
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  query.timestamp = { $gte: startDate };

  const changes = await Change.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean()
    .exec();

  return changes;
}

/**
 * Get changes for a specific person
 *
 * @param {String} personId - Person ID
 * @returns {Promise<Array>} Change records
 */
async function getPersonChanges(personId) {
  const changes = await Change.find({ person_id: personId })
    .sort({ timestamp: -1 })
    .lean()
    .exec();

  return changes;
}

module.exports = {
  detectChanges,
  getRecentChanges,
  getPersonChanges,
};
