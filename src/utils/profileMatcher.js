/**
 * Profile Matching Logic
 *
 * Implements deterministic identity resolution with strict priority:
 * 1. salesNavId (immutable LinkedIn anchor)
 * 2. duxsoupId (unique per user, but format varies)
 * 3. linkedInUsername (stable but mutable - check for conflicts)
 * 4. URL-based identifiers (fallback)
 *
 * CRITICAL: All database queries use case-insensitive matching for salesNavId
 * to handle lowercase IDs in URLs (e.g., acwaaa vs ACwAAA)
 */

const Person = require("../models/person");
const logger = require("./logger");
const {
  extractSalesNavId,
  _extractSalesNavIdFromUrl,
  normalizeToCanonicalCase,
  extractNumericId,
} = require("./salesNavIdExtractor");
const { extractLinkedInUsername, normalizeUrl } = require("./identityMatcher");

/**
 * Find matching profile in database using strict priority matching
 *
 * Priority Flow:
 * 1. salesNavId (case-insensitive DB query)
 * 2. duxsoupId (exact match)
 * 3. linkedInUsername (with conflict detection)
 * 4. URL-based identifiers
 *
 * @param {Object} data - Webhook/observation data
 * @returns {Promise<Object>} Match result with person and match type
 *
 * @example
 * const result = await findMatchingProfile(webhookData);
 * if (result.match) {
 *   console.log('Found:', result.person._id);
 *   console.log('Matched by:', result.matchType);
 * }
 */
async function findMatchingProfile(data) {
  if (!data) {
    throw new Error("Data is required for profile matching");
  }

  // ═══════════════════════════════════════════════════════════
  // STEP A: PRE-PROCESSING - Extract all identifiers
  // ═══════════════════════════════════════════════════════════

  // Extract salesNavId from ALL available URL fields
  const salesNavId = extractSalesNavId(data);

  // Extract other identifiers
  const duxsoupId = data.id || data.data?.id || null;
  const numericId = duxsoupId ? extractNumericId(duxsoupId) : null;
  const linkedInUsername = extractLinkedInUsername(data);

  logger.debug("Extracted identifiers for matching", {
    salesNavId: salesNavId || "none",
    duxsoupId: duxsoupId || "none",
    numericId: numericId || "none",
    linkedInUsername: linkedInUsername || "none",
  });

  // ═══════════════════════════════════════════════════════════
  // STEP B: PRIMARY MATCH - salesNavId (HIGHEST PRIORITY)
  // ═══════════════════════════════════════════════════════════

  if (salesNavId) {
    logger.debug("Attempting salesNavId match", { salesNavId });

    // CRITICAL: Case-insensitive query
    // DB might have "ACwAAA123" but URL might have "acwaaa123"
    // These MUST match
    const escapedId = salesNavId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const existingPerson = await Person.findOne({
      "aliases.type": "salesNavId",
      "aliases.value": {
        $regex: new RegExp(`^${escapedId}$`, "i"), // Case-insensitive match
      },
    });

    if (existingPerson) {
      logger.info("Match found by salesNavId", {
        person_id: existingPerson._id,
        salesNavId,
      });

      // BEST PRACTICE: Normalize DB to canonical case if needed
      const dbValue = existingPerson.aliases.find(
        (a) => a.type === "salesNavId",
      )?.value;
      const canonicalId = normalizeToCanonicalCase(salesNavId);

      if (dbValue !== canonicalId) {
        logger.info("Will normalize salesNavId to canonical case", {
          person_id: existingPerson._id,
          from: dbValue,
          to: canonicalId,
        });

        // Note: Actual update happens in the caller (identityResolverService)
        // to avoid race conditions. We just log the intent here.
      }

      return {
        match: true,
        person: existingPerson,
        matchType: "salesNavId",
        priority: 1,
        canonicalId, // Return canonical form for caller to update
      };
    }

    logger.debug("No match found by salesNavId", { salesNavId });
  }

  // ═══════════════════════════════════════════════════════════
  // STEP C: SECONDARY MATCH - duxsoupId
  // ═══════════════════════════════════════════════════════════

  if (duxsoupId) {
    logger.debug("Attempting duxsoupId match", { duxsoupId });

    const existingPerson = await Person.findOne({
      "aliases.type": "duxsoupId",
      "aliases.value": duxsoupId, // Exact match (no case sensitivity issues)
    });

    if (existingPerson) {
      logger.info("Match found by duxsoupId", {
        person_id: existingPerson._id,
        duxsoupId,
      });

      return {
        match: true,
        person: existingPerson,
        matchType: "duxsoupId",
        priority: 2,
      };
    }

    logger.debug("No match found by duxsoupId", { duxsoupId });
  }

  // Also try numeric ID if available
  if (numericId) {
    logger.debug("Attempting numericId match", { numericId });

    const existingPerson = await Person.findOne({
      "aliases.type": "numericId",
      "aliases.value": numericId,
    });

    if (existingPerson) {
      logger.info("Match found by numericId", {
        person_id: existingPerson._id,
        numericId,
      });

      return {
        match: true,
        person: existingPerson,
        matchType: "numericId",
        priority: 2,
      };
    }

    logger.debug("No match found by numericId", { numericId });
  }

  // ═══════════════════════════════════════════════════════════
  // STEP D: TERTIARY MATCH - linkedInUsername
  // ═══════════════════════════════════════════════════════════

  if (linkedInUsername) {
    logger.debug("Attempting linkedInUsername match", { linkedInUsername });

    const candidates = await Person.find({
      "aliases.type": "linkedInUsername",
      "aliases.value": linkedInUsername, // Already lowercase
    });

    if (candidates.length === 0) {
      logger.debug("No match found by linkedInUsername", { linkedInUsername });
    } else if (candidates.length === 1) {
      const candidate = candidates[0];

      // ⚠️ CRITICAL: Check for salesNavId conflict
      // If username matches but salesNavIds differ, this is a username recycle/collision
      const candidateSalesNavId = candidate.aliases.find(
        (a) => a.type === "salesNavId",
      )?.value;

      if (candidateSalesNavId && salesNavId) {
        // Case-insensitive comparison
        if (candidateSalesNavId.toLowerCase() !== salesNavId.toLowerCase()) {
          // Username collision detected - DO NOT MERGE
          logger.warn("Username conflict: salesNavId mismatch", {
            username: linkedInUsername,
            existing_salesNavId: candidateSalesNavId,
            incoming_salesNavId: salesNavId,
            existing_person_id: candidate._id,
          });

          return {
            match: false,
            reason: "username_conflict",
            conflict: {
              username: linkedInUsername,
              existingPerson: candidate,
              existingSalesNavId: candidateSalesNavId,
              incomingSalesNavId: salesNavId,
            },
          };
        }
      }

      // No conflict - safe to match
      logger.info("Match found by linkedInUsername", {
        person_id: candidate._id,
        linkedInUsername,
      });

      return {
        match: true,
        person: candidate,
        matchType: "linkedInUsername",
        priority: 3,
      };
    } else {
      // Multiple matches - likely needs merge
      logger.warn("Multiple people match linkedInUsername", {
        linkedInUsername,
        match_count: candidates.length,
        matched_ids: candidates.map((c) => c._id),
      });

      return {
        match: true,
        multipleMatches: candidates,
        matchType: "linkedInUsername",
        requiresMerge: true,
        priority: 3,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP E: FALLBACK - URL-based identifiers
  // ═══════════════════════════════════════════════════════════

  // Try profileUrl
  const profileUrl = normalizeUrl(data.Profile || data.data?.Profile);
  if (profileUrl) {
    logger.debug("Attempting profileUrl match", { profileUrl });

    const existingPerson = await Person.findOne({
      "aliases.type": "profileUrl",
      "aliases.value": profileUrl,
    });

    if (existingPerson) {
      logger.info("Match found by profileUrl", {
        person_id: existingPerson._id,
        profileUrl,
      });

      return {
        match: true,
        person: existingPerson,
        matchType: "profileUrl",
        priority: 4,
      };
    }
  }

  // Try publicProfile
  const publicProfile = normalizeUrl(
    data.PublicProfile || data.data?.PublicProfile,
  );
  if (publicProfile) {
    logger.debug("Attempting publicProfile match", { publicProfile });

    const existingPerson = await Person.findOne({
      "aliases.type": "publicUrl",
      "aliases.value": publicProfile,
    });

    if (existingPerson) {
      logger.info("Match found by publicProfile", {
        person_id: existingPerson._id,
        publicProfile,
      });

      return {
        match: true,
        person: existingPerson,
        matchType: "publicUrl",
        priority: 4,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NO MATCH FOUND
  // ═══════════════════════════════════════════════════════════

  logger.info("No matching profile found", {
    salesNavId: salesNavId || "none",
    duxsoupId: duxsoupId || "none",
    linkedInUsername: linkedInUsername || "none",
  });

  return {
    match: false,
    reason: "no_stable_id_match",
    extractedIdentifiers: {
      salesNavId,
      duxsoupId,
      numericId,
      linkedInUsername,
    },
  };
}

/**
 * Extract all identifiers from data for alias creation
 * Used by identityResolverService to build alias array
 *
 * @param {Object} data - Webhook/observation data
 * @returns {Array} Array of { type, value } alias objects
 */
function extractAllIdentifiers(data) {
  const aliases = [];

  // Extract salesNavId
  const salesNavId = extractSalesNavId(data);
  if (salesNavId) {
    const canonicalId = normalizeToCanonicalCase(salesNavId);
    aliases.push({ type: "salesNavId", value: canonicalId });
  }

  // Extract duxsoupId
  const duxsoupId = data.id || data.data?.id;
  if (duxsoupId) {
    aliases.push({ type: "duxsoupId", value: duxsoupId });
  }

  // Extract numericId (from duxsoupId)
  const numericId = duxsoupId ? extractNumericId(duxsoupId) : null;
  if (numericId) {
    aliases.push({ type: "numericId", value: numericId });
  }

  // Extract linkedInUsername
  const linkedInUsername = extractLinkedInUsername(data);
  if (linkedInUsername) {
    aliases.push({ type: "linkedInUsername", value: linkedInUsername });
  }

  // Extract URL-based identifiers
  const profileUrl = normalizeUrl(data.Profile || data.data?.Profile);
  if (profileUrl) {
    aliases.push({ type: "profileUrl", value: profileUrl });
  }

  const publicProfile = normalizeUrl(
    data.PublicProfile || data.data?.PublicProfile,
  );
  if (publicProfile) {
    aliases.push({ type: "publicUrl", value: publicProfile });
  }

  const recruiterProfile = normalizeUrl(
    data.RecruiterProfile || data.data?.RecruiterProfile,
  );
  if (recruiterProfile) {
    aliases.push({ type: "recruiterUrl", value: recruiterProfile });
  }

  // Extract from additional URL fields
  const salesUrl = data.salesUrl || data.data?.salesUrl;
  if (salesUrl) {
    const normalized = normalizeUrl(salesUrl);
    if (normalized) {
      aliases.push({ type: "salesUrl", value: normalized });
    }
  }

  return aliases;
}

module.exports = {
  findMatchingProfile,
  extractAllIdentifiers,
};
