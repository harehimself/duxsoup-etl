const Person = require("../models/person");
const identityResolverService = require("../services/identityResolverService");
const { resolvePersonIdentity } = require("../utils/identityMatcher");
const logger = require("../utils/logger");
const { parseSafeDate, parseBirthdayDate } = require("../utils/date-parser");
const { parseLocation } = require("../utils/location-parser");
const { detectChanges } = require("../services/changeDetectionService");
const { parseTitle, getHighestSeniorityRole } = require("../utils/titleParser");

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
 * Parse connections string to number
 * Handles: "500", "1234", "500+" (strips +)
 * @param {string|number} value - Connection count from webhook
 * @returns {number|null} Parsed number or null if invalid
 */
function parseConnections(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;

  const str = String(value).trim();
  if (str === "") return null;

  // Remove "+" suffix if present
  const cleaned = str.replace(/\+$/, "");

  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num < 0) {
    logger.warn("Invalid connections value", { value });
    return null;
  }

  return num;
}

/**
 * Parse degree string to number
 * Handles: "1", "2", "3", "1st", "2nd", "3rd"
 * @param {string|number} value - Connection degree from webhook
 * @returns {number|null} Parsed number (1-3) or null if invalid
 */
function parseDegree(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;

  const str = String(value).trim().toLowerCase();
  if (str === "") return null;

  // Handle "1st", "2nd", "3rd" format
  const ordinalMatch = str.match(/^(\d+)(st|nd|rd|th)?$/);
  if (ordinalMatch) {
    const num = parseInt(ordinalMatch[1], 10);
    if (num >= 1 && num <= 3) {
      return num;
    }
    logger.warn("Degree out of range (1-3)", { value });
    return null;
  }

  // Handle plain numbers
  const num = parseInt(str, 10);
  if (!isNaN(num) && num >= 1 && num <= 3) {
    return num;
  }

  logger.warn("Invalid degree value", { value });
  return null;
}

/**
 * Determine if incoming value should overwrite existing snapshot value
 *
 * @param {Object} existingMeta - { value, observedAt, source, observationId }
 * @param {Object} incomingMeta - { value, observedAt, source, observationId }
 * @returns {boolean} True if incoming should overwrite existing
 */
function shouldOverwrite(existingMeta, incomingMeta) {
  // Always accept if no existing value
  if (
    !existingMeta ||
    existingMeta.value === null ||
    existingMeta.value === undefined
  ) {
    return true;
  }

  // Check if incoming value is empty/blank
  const isIncomingEmpty = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    if (typeof value === "number" && isNaN(value)) return true;
    return false;
  };

  // Never overwrite with empty/blank incoming
  if (isIncomingEmpty(incomingMeta.value)) {
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
 * Clear a derived (computed) field, bypassing the "never overwrite with empty" rule.
 *
 * Derived fields like parsedSeniority and parsedDepartment are computed from
 * observed data, not observed directly. The shouldOverwrite guard that prevents
 * nulling observed fields must not apply here — when the source value no longer
 * produces a derived result, the derived field must be cleared.
 *
 * @param {Object} snapshot - Current snapshot object
 * @param {string} fieldPath - Field to clear (e.g., 'parsedDepartment')
 * @param {Object} observationMeta - { observedAt, source, observationId }
 * @returns {boolean} True if field was cleared (false if already null)
 */
function clearDerivedField(snapshot, fieldPath, observationMeta) {
  if (snapshot[fieldPath] == null) {
    return false; // Already null/undefined, nothing to clear
  }

  snapshot[fieldPath] = null;

  if (!snapshot._meta) {
    snapshot._meta = {};
  }
  snapshot._meta[fieldPath] = {
    value: null,
    observedAt: observationMeta.observedAt,
    source: observationMeta.source,
    observationId: observationMeta.observationId,
  };

  return true;
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
  const _metaPath = `_meta.${fieldPath}`;
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
 * @returns {Object} Derived metrics including tenure and highest seniority
 */
function computeDerivedMetrics(roles) {
  if (!roles || roles.length === 0) {
    return {
      avgTenureMonths: null,
      yearsAtCurrentCompany: null,
      highestSeniority: null,
      highestSeniorityRank: null,
      highestSeniorityRoleTitle: null,
      highestSeniorityRoleCompany: null,
    };
  }

  const now = new Date();
  let totalTenureMonths = 0;
  let roleCount = 0;
  let currentCompanyYears = null;

  roles.forEach((role) => {
    const startDate = parseSafeDate(role.startDate);
    const endDate = role.endDate
      ? parseSafeDate(role.endDate)
      : role.isCurrent
        ? now
        : null;

    if (startDate && endDate) {
      const tenureMonths =
        (endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44); // Average month
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

  // Get the role with highest seniority tier
  const highestRole = getHighestSeniorityRole(roles);

  return {
    avgTenureMonths:
      roleCount > 0 ? Math.round(totalTenureMonths / roleCount) : null,
    yearsAtCurrentCompany:
      currentCompanyYears !== null
        ? Math.round(currentCompanyYears * 10) / 10
        : null,
    highestSeniority: highestRole?.seniority || null,
    highestSeniorityRank: highestRole?.seniorityRank || null,
    highestSeniorityRoleTitle: highestRole?.title || null,
    highestSeniorityRoleCompany: highestRole?.companyName || null,
  };
}

/**
 * Parse and add seniority classification to a role
 * @param {Object} role - Role object with title
 * @returns {Object} Role with seniority and seniorityRank added
 */
function enrichRoleWithSeniority(role) {
  if (role.title) {
    const parsed = parseTitle(role.title);
    role.seniority = parsed.seniority;
    role.seniorityRank = parsed.seniorityRank;
  }
  return role;
}

/**
 * Update roles timeline from observation
 *
 * @param {Object} person - Person document
 * @param {Object} observationData - Visit or scan data
 * @param {Object} observationMeta - { observed_at, source, observation_id }
 * @returns {boolean} True if roles were updated
 */
function updateRolesTimeline(person, observationData, _observationMeta) {
  let updated = false;

  // Extract positions from extended data (visits) or current position (scans)
  const positions = observationData.extended?.positions || [];
  const currentRole = observationData.Title || observationData.title;
  const currentCompany = observationData.Company || observationData.company;
  const currentCompanyId =
    observationData.CompanyID || observationData.companyId;

  // If we have extended positions, process them
  if (positions.length > 0) {
    positions.forEach((pos) => {
      const _roleKey = `${pos.Title}|${pos.Company}|${pos.From}`;

      // Check if role already exists
      const parsedFromDate = parseSafeDate(pos.From);
      const existingRole = person.snapshot.roles.find(
        (r) =>
          r.title === pos.Title &&
          r.companyName === pos.Company &&
          r.startDate?.toString() === parsedFromDate?.toString(),
      );

      if (!existingRole) {
        // Add new role with seniority classification
        const newRole = enrichRoleWithSeniority({
          title: pos.Title,
          companyId: null, // Will be resolved separately
          companyName: pos.Company,
          location: pos.Location,
          description: pos.Description,
          startDate: parseSafeDate(pos.From),
          endDate:
            pos.To && pos.To !== "Present" ? parseSafeDate(pos.To) : null,
          isCurrent: pos.To === "Present" || !pos.To,
        });
        person.snapshot.roles.push(newRole);
        updated = true;
      }
    });
  } else if (currentRole && currentCompany) {
    // Single current role from scan/visit
    const existingCurrentRole = person.snapshot.roles.find(
      (r) =>
        r.title === currentRole &&
        r.companyName === currentCompany &&
        r.isCurrent,
    );

    if (!existingCurrentRole) {
      // Add current role with seniority classification
      const newRole = enrichRoleWithSeniority({
        title: currentRole,
        companyId: currentCompanyId || null,
        companyName: currentCompany,
        location: observationData.Location,
        description: null,
        startDate: null, // Unknown without extended data
        endDate: null,
        isCurrent: true,
      });
      person.snapshot.roles.push(newRole);
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
    // Extract data from nested rawData.data structure if present, otherwise use top-level fields
    const webhookData =
      observationDoc.rawData?.data || observationDoc.rawData || observationDoc;
    const identity = resolvePersonIdentity(webhookData);

    if (!identity.person_id) {
      logger.warn("Cannot upsert person without stable ID", {
        observation_id: observationDoc._id,
        sourceType,
      });
      return null;
    }

    if (!identity.canonical_id || !identity.primary_id_type) {
      throw new Error("Missing canonical identity for observation");
    }

    logger.info("Upserting person from observation", {
      person_id: identity.person_id,
      observation_id: observationDoc._id,
      sourceType,
      identitySource: identity.source,
    });

    // Step 2: Resolve or create canonical person
    let person = await identityResolverService.resolveOrCreate(identity, {
      reason: "duplicate_detection", // Valid enum value for when merge is needed
      sourceObservationId: observationDoc._id,
    });

    // Step 3: Attach observation reference (using $addToSet for atomic uniqueness)
    const observationRef = observationDoc._id;
    const observedAt =
      webhookData.VisitTime || webhookData.ScanTime || new Date();

    const observationField =
      sourceType === "visit" ? "observations.visits" : "observations.scans";
    await Person.updateOne(
      { _id: person._id },
      { $addToSet: { [observationField]: observationRef } },
    );

    // Reload to get updated observations count
    person = await Person.findById(person._id);

    // Step 4: Update metadata
    person.meta = person.meta || {};
    person.meta.lastObservedAt = observedAt;
    person.meta.lastObservation = {
      type: sourceType,
      id: observationRef,
      observedAt: observedAt,
    };
    person.meta.observationsCount =
      (person.observations.visits.length || 0) +
      (person.observations.scans.length || 0);

    // Step 5: Merge aliases (already done by resolveOrCreate, but ensure latest)
    if (identity.aliases && identity.aliases.length > 0) {
      const existingValues = new Set(person.aliases.map((a) => a.value));
      const newAliases = identity.aliases.filter(
        (a) => !existingValues.has(a.value),
      );
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

    // Capture old snapshot for change detection (deep clone)
    const oldSnapshot = person.snapshot
      ? structuredClone(person.snapshot.toObject())
      : null;

    // Normalize basic fields
    normalizeField(
      person.snapshot,
      "firstName",
      webhookData["First Name"],
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "middleName",
      webhookData["Middle Name"],
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "lastName",
      webhookData["Last Name"],
      observationMeta,
    );

    // Birthday: reject year-less strings to avoid fabricated 2001 dates
    const birthdayResult = parseBirthdayDate(webhookData.Birthday);
    if (birthdayResult.date) {
      normalizeField(
        person.snapshot,
        "birthday",
        birthdayResult.date,
        observationMeta,
      );
    } else if (birthdayResult.raw) {
      // Year-less birthday (e.g. "March 14") — store as raw string, clear any coerced Date
      normalizeField(
        person.snapshot,
        "birthdayRaw",
        birthdayResult.raw,
        observationMeta,
      );
      if (person.snapshot.birthday) {
        person.snapshot.birthday = null;
        delete person.snapshot._meta.birthday;
      }
    }

    // Compute full name if we have components
    if (person.snapshot.firstName || person.snapshot.lastName) {
      const fullName = [
        person.snapshot.firstName,
        person.snapshot.middleName,
        person.snapshot.lastName,
      ]
        .filter(Boolean)
        .join(" ");
      normalizeField(person.snapshot, "fullName", fullName, observationMeta);
    }

    normalizeField(
      person.snapshot,
      "currentTitle",
      webhookData.Title,
      observationMeta,
    );

    // Enrich with parsed title (seniority + department)
    if (person.snapshot.currentTitle) {
      const parsed = parseTitle(person.snapshot.currentTitle);
      if (parsed.seniority) {
        normalizeField(
          person.snapshot,
          "parsedSeniority",
          parsed.seniority,
          observationMeta,
        );
      } else {
        clearDerivedField(person.snapshot, "parsedSeniority", observationMeta);
      }
      if (parsed.department) {
        normalizeField(
          person.snapshot,
          "parsedDepartment",
          parsed.department,
          observationMeta,
        );
      } else {
        clearDerivedField(person.snapshot, "parsedDepartment", observationMeta);
      }
    }

    normalizeField(
      person.snapshot,
      "currentCompany",
      webhookData.Company,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "currentCompanyId",
      webhookData.CompanyID,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "currentCompanyProfile",
      webhookData.CompanyProfile,
      observationMeta,
    );

    // Compute currentCompanyUrl from currentCompanyId (priority 1)
    if (person.snapshot.currentCompanyId) {
      const companyUrl = `www.linkedin.com/company/${person.snapshot.currentCompanyId}`;
      normalizeField(
        person.snapshot,
        "currentCompanyUrl",
        companyUrl,
        observationMeta,
      );
    } else if (person.snapshot.currentCompanyProfile) {
      // Fallback to normalized CompanyProfile if no numeric ID
      const { extractCompanyProfileUrl } = require("../utils/identityMatcher");
      const normalizedUrl = extractCompanyProfileUrl(
        person.snapshot.currentCompanyProfile,
      );
      if (normalizedUrl) {
        normalizeField(
          person.snapshot,
          "currentCompanyUrl",
          normalizedUrl,
          observationMeta,
        );
      }
    }

    normalizeField(
      person.snapshot,
      "location",
      webhookData.Location,
      observationMeta,
    );

    // Parse and normalize structured location fields
    if (webhookData.Location) {
      const parsedLocation = parseLocation(webhookData.Location);
      normalizeField(
        person.snapshot,
        "city",
        parsedLocation.city,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "state",
        parsedLocation.state,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "stateCode",
        parsedLocation.stateCode,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "country",
        parsedLocation.country,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "countryCode",
        parsedLocation.countryCode,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "province",
        parsedLocation.province,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "region",
        parsedLocation.region,
        observationMeta,
      );
      normalizeField(
        person.snapshot,
        "locationType",
        parsedLocation.locationType,
        observationMeta,
      );
    }

    normalizeField(
      person.snapshot,
      "industry",
      webhookData.Industry,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "connections",
      parseConnections(webhookData.Connections),
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "summary",
      webhookData.Summary,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "degree",
      parseDegree(webhookData.Degree || webhookData["Connection Degree"]),
      observationMeta,
    );

    // Contact fields
    normalizeField(
      person.snapshot,
      "email",
      webhookData.Email,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "phone",
      webhookData.Phone,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "twitter",
      webhookData.Twitter,
      observationMeta,
    );

    // Profile images
    normalizeField(
      person.snapshot,
      "profilePicture",
      webhookData.Picture,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "thumbnail",
      webhookData.Thumbnail,
      observationMeta,
    );

    // Websites
    normalizeField(
      person.snapshot,
      "personalWebsite",
      webhookData.PersonalWebsite,
      observationMeta,
    );
    normalizeField(
      person.snapshot,
      "companyWebsite",
      webhookData.CompanyWebsite,
      observationMeta,
    );

    // Step 7: Update roles timeline
    if (!person.snapshot.roles) {
      person.snapshot.roles = [];
    }
    updateRolesTimeline(person, webhookData, observationMeta);

    // Step 8: Update education if present
    if (
      webhookData.extended?.schools &&
      webhookData.extended.schools.length > 0
    ) {
      if (!person.snapshot.education) {
        person.snapshot.education = [];
      }

      webhookData.extended.schools.forEach((school) => {
        const exists = person.snapshot.education.find(
          (e) =>
            e.school === school.Name &&
            e.degree === school.Degree &&
            e.field === school.Field,
        );

        if (!exists) {
          person.snapshot.education.push({
            school: school.Name,
            degree: school.Degree,
            field: school.Field,
            startDate: parseSafeDate(school.From),
            endDate: parseSafeDate(school.To),
          });
        }
      });
    }

    // Step 9: Update skills if present
    if (
      webhookData.extended?.skills &&
      webhookData.extended.skills.length > 0
    ) {
      if (!person.snapshot.skills) {
        person.snapshot.skills = [];
      }

      const existingSkills = new Set(person.snapshot.skills);
      webhookData.extended.skills.forEach((skill) => {
        if (!existingSkills.has(skill)) {
          person.snapshot.skills.push(skill);
        }
      });
    }

    // Step 10: Compute derived metrics
    person.derived = computeDerivedMetrics(person.snapshot.roles);

    // Step 10.5: Detect changes (job changes, promotions, title changes)
    let _detectedChanges = [];
    try {
      const changes = await detectChanges(
        person,
        oldSnapshot,
        person.snapshot,
        observationRef,
      );

      if (changes && changes.length > 0) {
        _detectedChanges = changes;
        logger.info("Changes detected during person update", {
          person_id: person._id,
          changeCount: changes.length,
          changeTypes: changes.map((c) => c.type),
        });
      }
    } catch (error) {
      // Log error but don't fail the entire upsert
      logger.error("Failed to detect changes", {
        person_id: person._id,
        error: error.message,
        stack: error.stack,
      });
    }

    // Step 11: Save and return
    await person.save();

    logger.info("Successfully upserted person from observation", {
      person_id: person._id,
      observation_id: observationRef,
      sourceType,
      observations_count: person.meta.observations_count,
    });

    return person;
  } catch (error) {
    logger.error("Failed to upsert person from observation", {
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
  clearDerivedField, // Export for testing
  computeDerivedMetrics, // Export for testing
  updateRolesTimeline, // Export for testing
};
