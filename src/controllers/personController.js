const Person = require('../models/person');
const identityResolverService = require('../services/identityResolverService');
const { resolvePersonIdentity, resolveCompanyIdentity } = require('../utils/identityResolver');
const logger = require('../utils/logger');

/**
 * Person Controller
 *
 * Manages canonical person snapshots using the Observation-Snapshot pattern.
 * Updates person records from visit/scan observations with strict precedence rules.
 *
 * Precedence Rules:
 * 1. Ignore empty/blank incoming values
 * 2. Visit beats scan for conflicting non-empty values
 * 3. Newer beats older within same source type
 */

/**
 * Determine if incoming value should overwrite existing snapshot value
 *
 * @param {Object} existingMeta - { value, observedAt, source, observationId }
 * @param {Object} incomingMeta - { value, observedAt, source, observationId }
 * @returns {boolean} True if incoming should overwrite existing
 */
function shouldOverwrite(existingMeta, incomingMeta) {
  // Always accept if no existing value
  if (!existingMeta || !existingMeta.value) {
    return true;
  }

  // Never overwrite with empty/blank incoming
  if (!incomingMeta.value || incomingMeta.value.trim() === '') {
    return false;
  }

  // Source precedence: visit > scan
  const sourcePrecedence = { visit: 2, scan: 1 };
  const existingPrecedence = sourcePrecedence[existingMeta.source] || 0;
  const incomingPrecedence = sourcePrecedence[incomingMeta.source] || 0;

  if (incomingPrecedence > existingPrecedence) {
    return true; // Higher precedence wins
  }

  if (incomingPrecedence < existingPrecedence) {
    return false; // Lower precedence loses
  }

  // Same precedence: newer wins
  const existingTime = new Date(existingMeta.observedAt).getTime();
  const incomingTime = new Date(incomingMeta.observedAt).getTime();

  return incomingTime >= existingTime;
}

/**
 * Normalize a field with provenance tracking
 *
 * @param {Object} snapshot - Current snapshot object
 * @param {string} fieldPath - Dot-notation field path (e.g., 'firstName')
 * @param {*} incomingValue - New value from observation
 * @param {Object} observationMeta - { observedAt, source, observationId }
 * @returns {boolean} True if value was updated
 */
function normalizeField(snapshot, fieldPath, incomingValue, observationMeta) {
  // Get existing metadata
  const metaPath = `_meta.${fieldPath}`;
  const existingMeta = snapshot._meta?.[fieldPath];

  const incomingMeta = {
    value: incomingValue,
    observedAt: observationMeta.observedAt,
    source: observationMeta.source,
    observationId: observationMeta.observationId,
  };

  if (shouldOverwrite(existingMeta, incomingMeta)) {
    // Update field value
    snapshot[fieldPath] = incomingValue;

    // Update provenance metadata
    if (!snapshot._meta) {
      snapshot._meta = {};
    }
    snapshot._meta[fieldPath] = incomingMeta;

    return true;
  }

  return false;
}

/**
 * Compute derived metrics from roles timeline
 *
 * @param {Array} roles - Array of role objects
 * @returns {Object} { avg_tenure_months, years_at_current_company }
 */
function computeDerivedMetrics(roles) {
  if (!roles || roles.length === 0) {
    return {
      avg_tenure_months: null,
      years_at_current_company: null,
    };
  }

  const now = new Date();
  let totalTenureMonths = 0;
  let roleCount = 0;
  let currentCompanyYears = null;

  roles.forEach(role => {
    const startDate = role.startDate ? new Date(role.startDate) : null;
    const endDate = role.endDate ? new Date(role.endDate) : (role.isCurrent ? now : null);

    if (startDate && endDate) {
      const tenureMonths = (endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44); // Average month
      totalTenureMonths += tenureMonths;
      roleCount++;

      // Calculate current company tenure
      if (role.isCurrent) {
        const years = (now - startDate) / (1000 * 60 * 60 * 24 * 365.25);
        if (currentCompanyYears === null || years > currentCompanyYears) {
          currentCompanyYears = years;
        }
      }
    }
  });

  return {
    avg_tenure_months: roleCount > 0 ? Math.round(totalTenureMonths / roleCount) : null,
    years_at_current_company: currentCompanyYears !== null ? Math.round(currentCompanyYears * 10) / 10 : null,
  };
}

/**
 * Update roles timeline from observation
 *
 * @param {Object} person - Person document
 * @param {Object} observationData - Visit or scan data
 * @param {Object} observationMeta - { observed_at, source, observation_id }
 * @returns {boolean} True if roles were updated
 */
function updateRolesTimeline(person, observationData, observationMeta) {
  let updated = false;

  // Extract positions from extended data (visits) or current position (scans)
  const positions = observationData.extended?.positions || [];
  const currentRole = observationData.Title || observationData.title;
  const currentCompany = observationData.Company || observationData.company;
  const currentCompanyId = observationData.CompanyID || observationData.companyId;

  // If we have extended positions, process them
  if (positions.length > 0) {
    positions.forEach(pos => {
      const roleKey = `${pos.Title}|${pos.Company}|${pos.From}`;

      // Check if role already exists
      const existingRole = person.snapshot.roles.find(r =>
        r.title === pos.Title &&
        r.companyName === pos.Company &&
        r.startDate?.toString() === new Date(pos.From).toString()
      );

      if (!existingRole) {
        // Add new role
        person.snapshot.roles.push({
          title: pos.Title,
          companyId: null, // Will be resolved separately
          companyName: pos.Company,
          location: pos.Location,
          description: pos.Description,
          startDate: pos.From ? new Date(pos.From) : null,
          endDate: pos.To && pos.To !== 'Present' ? new Date(pos.To) : null,
          isCurrent: pos.To === 'Present' || !pos.To,
        });
        updated = true;
      }
    });
  } else if (currentRole && currentCompany) {
    // Single current role from scan/visit
    const existingCurrentRole = person.snapshot.roles.find(r =>
      r.title === currentRole &&
      r.companyName === currentCompany &&
      r.isCurrent
    );

    if (!existingCurrentRole) {
      // Add current role
      person.snapshot.roles.push({
        title: currentRole,
        companyId: currentCompanyId || null,
        companyName: currentCompany,
        location: observationData.Location,
        description: null,
        startDate: null, // Unknown without extended data
        endDate: null,
        isCurrent: true,
      });
      updated = true;
    } else if (currentCompanyId && !existingCurrentRole.companyId) {
      // Update company ID if we now have it
      existingCurrentRole.companyId = currentCompanyId;
      updated = true;
    }
  }

  return updated;
}

/**
 * Upsert person snapshot from observation
 *
 * @param {Object} observationDoc - Visit or Scan document
 * @param {string} sourceType - 'visit' or 'scan'
 * @returns {Promise<Object>} Updated person document
 */
async function upsertFromObservation(observationDoc, sourceType) {
  try {
    // Step 1: Resolve identity
    const webhookData = observationDoc.rawData || observationDoc;
    const identity = resolvePersonIdentity(webhookData);

    if (!identity.person_id) {
      logger.warn('Cannot upsert person without stable ID', {
        observation_id: observationDoc._id,
        sourceType,
      });
      return null;
    }

    if (!identity.canonical_id || !identity.primary_id_type) {
      throw new Error('Missing canonical identity for observation');
    }

    logger.info('Upserting person from observation', {
      person_id: identity.person_id,
      observation_id: observationDoc._id,
      sourceType,
      identitySource: identity.source,
    });

    // Step 2: Resolve or create canonical person
    const person = await identityResolverService.resolveOrCreate(identity, {
      reason: `${sourceType}_observation`,
      sourceObservationId: observationDoc._id,
    });

    // Step 3: Attach observation reference
    const observationRef = observationDoc._id;
    const observedAt = webhookData.VisitTime || webhookData.ScanTime || new Date();

    if (sourceType === 'visit' && !person.observations.visits.includes(observationRef)) {
      person.observations.visits.push(observationRef);
    } else if (sourceType === 'scan' && !person.observations.scans.includes(observationRef)) {
      person.observations.scans.push(observationRef);
    }

    // Step 4: Update metadata
    person.meta = person.meta || {};
    person.meta.lastObservedAt = observedAt;
    person.meta.lastObservation = {
      type: sourceType,
      id: observationRef,
      observedAt: observedAt,
    };
    person.meta.observationsCount = (person.observations.visits.length || 0) + (person.observations.scans.length || 0);

    // Step 5: Merge aliases (already done by resolveOrCreate, but ensure latest)
    if (identity.aliases && identity.aliases.length > 0) {
      const existingValues = new Set(person.aliases.map(a => a.value));
      const newAliases = identity.aliases.filter(a => !existingValues.has(a.value));
      person.aliases.push(...newAliases);
    }

    // Step 6: Update normalized fields with precedence
    const observationMeta = {
      observedAt: observedAt,
      source: sourceType,
      observationId: observationRef,
    };

    // Initialize metadata structure if needed
    if (!person.snapshot._meta) {
      person.snapshot._meta = {};
    }

    // Normalize basic fields
    normalizeField(person.snapshot, 'firstName', webhookData['First Name'], observationMeta);
    normalizeField(person.snapshot, 'middleName', webhookData['Middle Name'], observationMeta);
    normalizeField(person.snapshot, 'lastName', webhookData['Last Name'], observationMeta);

    // Compute full name if we have components
    if (person.snapshot.firstName || person.snapshot.lastName) {
      const fullName = [
        person.snapshot.firstName,
        person.snapshot.middleName,
        person.snapshot.lastName,
      ].filter(Boolean).join(' ');
      normalizeField(person.snapshot, 'fullName', fullName, observationMeta);
    }

    normalizeField(person.snapshot, 'currentTitle', webhookData.Title, observationMeta);
    normalizeField(person.snapshot, 'currentCompany', webhookData.Company, observationMeta);
    normalizeField(person.snapshot, 'currentCompanyId', webhookData.CompanyID, observationMeta);
    normalizeField(person.snapshot, 'location', webhookData.Location, observationMeta);
    normalizeField(person.snapshot, 'industry', webhookData.Industry, observationMeta);
    normalizeField(person.snapshot, 'connections', webhookData.Connections, observationMeta);
    normalizeField(person.snapshot, 'summary', webhookData.Summary, observationMeta);
    normalizeField(person.snapshot, 'degree', webhookData.Degree || webhookData['Connection Degree'], observationMeta);

    // Contact fields
    normalizeField(person.snapshot, 'email', webhookData.Email, observationMeta);
    normalizeField(person.snapshot, 'phone', webhookData.Phone, observationMeta);
    normalizeField(person.snapshot, 'twitter', webhookData.Twitter, observationMeta);

    // Profile images
    normalizeField(person.snapshot, 'profilePicture', webhookData.Picture, observationMeta);
    normalizeField(person.snapshot, 'thumbnail', webhookData.Thumbnail, observationMeta);

    // Websites
    normalizeField(person.snapshot, 'personalWebsite', webhookData.PersonalWebsite, observationMeta);
    normalizeField(person.snapshot, 'companyWebsite', webhookData.CompanyWebsite, observationMeta);

    // Step 7: Update roles timeline
    if (!person.snapshot.roles) {
      person.snapshot.roles = [];
    }
    updateRolesTimeline(person, webhookData, observationMeta);

    // Step 8: Update education if present
    if (webhookData.extended?.schools && webhookData.extended.schools.length > 0) {
      if (!person.snapshot.education) {
        person.snapshot.education = [];
      }

      webhookData.extended.schools.forEach(school => {
        const exists = person.snapshot.education.find(e =>
          e.school === school.Name &&
          e.degree === school.Degree &&
          e.field === school.Field
        );

        if (!exists) {
          person.snapshot.education.push({
            school: school.Name,
            degree: school.Degree,
            field: school.Field,
            startDate: school.From ? new Date(school.From) : null,
            endDate: school.To ? new Date(school.To) : null,
          });
        }
      });
    }

    // Step 9: Update skills if present
    if (webhookData.extended?.skills && webhookData.extended.skills.length > 0) {
      if (!person.snapshot.skills) {
        person.snapshot.skills = [];
      }

      const existingSkills = new Set(person.snapshot.skills);
      webhookData.extended.skills.forEach(skill => {
        if (!existingSkills.has(skill)) {
          person.snapshot.skills.push(skill);
        }
      });
    }

    // Step 10: Compute derived metrics
    person.derived = computeDerivedMetrics(person.snapshot.roles);

    // Step 11: Save and return
    await person.save();

    logger.info('Successfully upserted person from observation', {
      person_id: person._id,
      observation_id: observationRef,
      sourceType,
      observations_count: person.meta.observations_count,
    });

    return person;
  } catch (error) {
    logger.error('Failed to upsert person from observation', {
      observation_id: observationDoc._id,
      sourceType,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = {
  upsertFromObservation,
  shouldOverwrite, // Export for testing
  normalizeField, // Export for testing
  computeDerivedMetrics, // Export for testing
  updateRolesTimeline, // Export for testing
};
