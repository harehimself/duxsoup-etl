const Person = require("../models/person");
const identityResolverService = require("../services/identityResolverService");
const { resolvePersonIdentity } = require("../utils/identityMatcher");
const logger = require("../utils/logger");
const { parseSafeDate, parseBirthdayDate } = require("../utils/date-parser");
const { parseLocation } = require("../utils/location-parser");
const { detectChanges } = require("../services/changeDetectionService");
const { parseTitle, getHighestSeniorityRole } = require("../utils/titleParser");
const { MAX_ROLES, MAX_EDUCATION, MAX_SKILLS } = require("../constants/limits");

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
 * Coerce a value to a string, handling DuxSoup rich objects like
 * { textDirection, text, attributesV2 } that occasionally appear
 * in place of plain strings for school names, degrees, etc.
 *
 * @param {*} value - Raw value from webhook
 * @returns {string|null} Plain string or null
 */
function coerceToString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.text != null)
    return String(value.text);
  return String(value);
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
 * Normalize a role text field for fuzzy comparison.
 * Trims whitespace, collapses internal whitespace, and lowercases.
 *
 * @param {string|null|undefined} text
 * @returns {string} Normalized string, or empty string for null/undefined
 */
function normalizeRoleText(text) {
  if (text == null) return "";
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Find an existing role that matches the incoming role data.
 *
 * When startDate is present: match on title + company + startDate (exact dates).
 * When startDate is null: match on title + company + isCurrent status,
 * with location and description as secondary discriminators to avoid
 * collapsing genuinely different undated roles.
 *
 * Title and company comparisons are case-insensitive and whitespace-normalized.
 *
 * @param {Array} existingRoles - Current roles array on the person snapshot
 * @param {Object} incoming - { title, companyName, startDate, endDate, isCurrent, location, description }
 * @returns {Object|undefined} Matching existing role, or undefined
 */
function findMatchingRole(existingRoles, incoming) {
  const normTitle = normalizeRoleText(incoming.title);
  const normCompany = normalizeRoleText(incoming.companyName);

  return existingRoles.find((r) => {
    if (normalizeRoleText(r.title) !== normTitle) return false;
    if (normalizeRoleText(r.companyName) !== normCompany) return false;

    if (incoming.startDate != null) {
      // Dated role: match on startDate
      return r.startDate?.toString() === incoming.startDate.toString();
    }

    // Undated incoming role.

    // For non-current undated roles, require the existing role to also be undated.
    // A historical role with a date is a different observation from one without.
    if (!incoming.isCurrent && r.startDate != null) return false;

    // isCurrent must match
    if (!!r.isCurrent !== !!incoming.isCurrent) return false;

    // Use location and description as secondary discriminators to prevent
    // collapsing genuinely distinct roles at the same title+company.
    const normExistLoc = normalizeRoleText(r.location);
    const normIncomingLoc = normalizeRoleText(incoming.location);
    if (normExistLoc && normIncomingLoc && normExistLoc !== normIncomingLoc) {
      return false;
    }

    const normExistDesc = normalizeRoleText(r.description);
    const normIncomingDesc = normalizeRoleText(incoming.description);
    if (
      normExistDesc &&
      normIncomingDesc &&
      normExistDesc !== normIncomingDesc
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Merge new information into an existing matched role.
 * Backfills empty/null fields on the existing role without overwriting populated fields.
 *
 * @param {Object} existingRole - The matched role to update in place
 * @param {Object} incoming - Incoming role data
 * @returns {boolean} True if any field was updated
 */
function mergeRoleFields(existingRole, incoming) {
  let merged = false;
  const backfillFields = [
    "companyId",
    "location",
    "description",
    "startDate",
    "endDate",
  ];

  for (const field of backfillFields) {
    if (
      incoming[field] != null &&
      incoming[field] !== "" &&
      (existingRole[field] == null || existingRole[field] === "")
    ) {
      existingRole[field] = incoming[field];
      merged = true;
    }
  }

  return merged;
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
      let startDate = parseSafeDate(pos.From);
      let endDate =
        pos.To && pos.To !== "Present" ? parseSafeDate(pos.To) : null;

      // Normalize inverted dates — keep role with startDate only
      if (endDate && startDate && endDate < startDate) {
        logger.warn("Role has endDate before startDate, nullifying endDate", {
          person_id: person._id,
          title: pos.Title,
          company: pos.Company,
          startDate,
          endDate,
        });
        endDate = null;
      }

      const isCurrent = pos.To === "Present" || !pos.To;

      const incoming = {
        title: pos.Title,
        companyName: pos.Company,
        startDate,
        endDate,
        isCurrent,
        location: pos.Location,
        description: pos.Description,
      };

      const existingRole = findMatchingRole(person.snapshot.roles, incoming);

      if (existingRole) {
        // Backfill any missing fields on the existing role
        if (mergeRoleFields(existingRole, incoming)) {
          updated = true;
        }
      } else {
        if (person.snapshot.roles.length >= MAX_ROLES) {
          logger.warn("Roles array at capacity, dropping new role", {
            person_id: person._id,
            currentCount: person.snapshot.roles.length,
            maxRoles: MAX_ROLES,
            droppedRole: {
              title: pos.Title,
              company: pos.Company,
              from: pos.From,
            },
          });
          return;
        }
        // Add new role with seniority classification
        const newRole = enrichRoleWithSeniority({
          title: pos.Title,
          companyId: null, // Will be resolved separately
          companyName: pos.Company,
          location: pos.Location,
          description: pos.Description,
          startDate,
          endDate,
          isCurrent,
        });
        person.snapshot.roles.push(newRole);
        updated = true;
      }
    });
  } else if (currentRole && currentCompany) {
    // Single current role from scan/visit — use normalized matching
    const incoming = {
      title: currentRole,
      companyName: currentCompany,
      startDate: null,
      endDate: null,
      isCurrent: true,
      location: observationData.Location,
      description: null,
    };

    const existingCurrentRole = findMatchingRole(
      person.snapshot.roles,
      incoming,
    );

    if (!existingCurrentRole) {
      if (person.snapshot.roles.length >= MAX_ROLES) {
        logger.warn("Roles array at capacity, dropping new role", {
          person_id: person._id,
          currentCount: person.snapshot.roles.length,
          maxRoles: MAX_ROLES,
          droppedRole: { title: currentRole, company: currentCompany },
        });
      } else {
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
      }
    } else {
      // Backfill companyId or other fields on the matched role
      const mergeData = { companyId: currentCompanyId || null };
      if (mergeRoleFields(existingCurrentRole, mergeData)) {
        updated = true;
      }
    }
  }

  return updated;
}

/**
 * Update education from observation
 *
 * @param {Object} person - Person document
 * @param {Array} schools - Array of school objects from webhook
 * @returns {boolean} True if education was updated
 */
function updateEducation(person, schools) {
  if (!schools || schools.length === 0) return false;

  if (!person.snapshot.education) {
    person.snapshot.education = [];
  }

  let updated = false;

  schools.forEach((school) => {
    const name = coerceToString(school.Name);
    const degree = coerceToString(school.Degree);
    const field = coerceToString(school.Field);

    const exists = person.snapshot.education.find(
      (e) => e.school === name && e.degree === degree && e.field === field,
    );

    if (!exists) {
      if (person.snapshot.education.length >= MAX_EDUCATION) {
        logger.warn("Education array at capacity, dropping new entry", {
          person_id: person._id,
          currentCount: person.snapshot.education.length,
          maxEducation: MAX_EDUCATION,
          droppedEntry: { school: name, degree, field },
        });
        return;
      }
      person.snapshot.education.push({
        school: name,
        degree,
        field,
        startDate: parseSafeDate(school.From),
        endDate: parseSafeDate(school.To),
      });
      updated = true;
    }
  });

  return updated;
}

/**
 * Update skills from observation
 *
 * @param {Object} person - Person document
 * @param {Array} skills - Array of skill strings from webhook
 * @returns {boolean} True if skills were updated
 */
function updateSkills(person, skills) {
  if (!skills || skills.length === 0) return false;

  if (!person.snapshot.skills) {
    person.snapshot.skills = [];
  }

  const existingSkills = new Set(person.snapshot.skills);
  let updated = false;
  let capWarningLogged = false;

  skills.forEach((skill) => {
    if (existingSkills.has(skill)) return;
    if (person.snapshot.skills.length >= MAX_SKILLS) {
      if (!capWarningLogged) {
        logger.warn("Skills array at capacity, dropping new skills", {
          person_id: person._id,
          currentCount: person.snapshot.skills.length,
          maxSkills: MAX_SKILLS,
        });
        capWarningLogged = true;
      }
      return;
    }
    person.snapshot.skills.push(skill);
    existingSkills.add(skill);
    updated = true;
  });

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
    updateEducation(person, webhookData.extended?.schools);

    // Step 9: Update skills if present
    updateSkills(person, webhookData.extended?.skills);

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
  updateEducation, // Export for testing
  updateSkills, // Export for testing
  coerceToString, // Export for testing
  normalizeRoleText, // Export for testing
  findMatchingRole, // Export for testing
  mergeRoleFields, // Export for testing
};
