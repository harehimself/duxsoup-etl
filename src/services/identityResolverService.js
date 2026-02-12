const Person = require("../models/person");
const {
  computeCanonicalId,
  buildCanonicalKey,
} = require("../utils/identityMatcher");
const {
  extractSalesNavId,
  normalizeToCanonicalCase,
} = require("../utils/salesNavIdExtractor");
const logger = require("../utils/logger");
const {
  MERGE_OBS_RATIO_THRESHOLD,
  MAX_OBSERVATION_REFS,
} = require("../constants/limits");

/**
 * Identity Resolver Service
 *
 * DB-backed alias matching and person deduplication.
 * Prevents duplicate person records when URLs or names change.
 *
 * Core responsibilities:
 * 1. Find existing person by any alias
 * 2. Resolve or create canonical person
 * 3. Merge people when aliases conflict
 * 4. Maintain alias integrity
 */

class IdentityResolverService {
  /**
   * Find people matching any of the provided aliases
   *
   * UPDATED: Now uses case-insensitive matching for salesNavId
   *
   * @param {Array} aliases - Array of { type, value } alias objects
   * @returns {Promise<Array>} Array of matching Person documents
   */
  async findByAnyAlias(aliases) {
    if (!aliases || aliases.length === 0) {
      return [];
    }

    try {
      // Build query conditions
      const conditions = [];

      // Group aliases by type
      const salesNavIdAliases = [];
      const linkedInUsernameAliases = [];
      const otherAliases = [];

      aliases.forEach((alias) => {
        if (alias.type === "salesNavId" && alias.value) {
          salesNavIdAliases.push(alias.value);
        } else if (alias.type === "linkedInUsername" && alias.value) {
          linkedInUsernameAliases.push(alias.value);
        } else if (alias.value) {
          otherAliases.push(alias.value);
        }
      });

      // Add case-insensitive query for salesNavId
      if (salesNavIdAliases.length > 0) {
        salesNavIdAliases.forEach((value) => {
          const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          conditions.push({
            "aliases.type": "salesNavId",
            "aliases.value": { $regex: new RegExp(`^${escapedValue}$`, "i") },
          });
        });
      }

      // Add case-insensitive query for linkedInUsername (LinkedIn treats usernames as case-insensitive)
      if (linkedInUsernameAliases.length > 0) {
        linkedInUsernameAliases.forEach((value) => {
          const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          conditions.push({
            "aliases.value": { $regex: new RegExp(`^${escapedValue}$`, "i") },
          });
        });
      }

      // Add exact match query for other aliases
      if (otherAliases.length > 0) {
        conditions.push({
          "aliases.value": { $in: otherAliases },
        });
      }

      if (conditions.length === 0) {
        return [];
      }

      // Find people matching any condition
      const people = await Person.find({
        $or: conditions,
      });

      return people;
    } catch (error) {
      logger.error("Failed to find people by aliases", {
        error: error.message,
        aliasCount: aliases.length,
      });
      throw error;
    }
  }

  /**
   * Merge aliases into a person document
   * Uses $addToSet to avoid duplicates
   *
   * @param {Object} person - Person document
   * @param {Array} newAliases - Array of { type, value } alias objects
   * @returns {Promise<Object>} Updated person document
   */
  async mergeAliases(person, newAliases) {
    if (!newAliases || newAliases.length === 0) {
      return person;
    }

    try {
      // Filter out aliases that already exist
      const existingValues = new Set(person.aliases.map((a) => a.value));
      const uniqueAliases = newAliases.filter(
        (a) => !existingValues.has(a.value),
      );

      if (uniqueAliases.length === 0) {
        return person;
      }

      // Use $addToSet to add only unique aliases
      const updated = await Person.findByIdAndUpdate(
        person._id,
        {
          $addToSet: {
            aliases: { $each: uniqueAliases },
          },
        },
        { new: true },
      );

      logger.info("Merged aliases into person", {
        person_id: person._id,
        newAliasCount: uniqueAliases.length,
      });

      return updated;
    } catch (error) {
      logger.error("Failed to merge aliases", {
        person_id: person._id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Determine the winner in a merge scenario
   * Deterministic rules (in priority order):
   * 1. Prefer doc with Sales Nav ID format (_id starts with ACwAAA)
   * 2. Prefer doc with most observations
   * 3. Prefer most recently updated
   * 4. Prefer lowest _id (lexical tie-breaker)
   *
   * @param {Array} people - Array of Person documents to compare
   * @returns {Object} Winner person document
   */
  determineWinner(people) {
    if (people.length === 0) {
      throw new Error("Cannot determine winner from empty array");
    }

    if (people.length === 1) {
      return people[0];
    }

    return people.reduce((winner, candidate) => {
      // Rule 1: Prefer Sales Nav ID format
      const winnerHasSalesNav = SALES_NAV_ID_PATTERN.test(winner._id);
      const candidateHasSalesNav = SALES_NAV_ID_PATTERN.test(candidate._id);

      if (candidateHasSalesNav && !winnerHasSalesNav) {
        return candidate;
      }
      if (winnerHasSalesNav && !candidateHasSalesNav) {
        return winner;
      }

      // Rule 2: Prefer most observations
      const winnerObsCount = winner.meta?.observationsCount || 0;
      const candidateObsCount = candidate.meta?.observationsCount || 0;

      if (candidateObsCount > winnerObsCount) {
        return candidate;
      }
      if (winnerObsCount > candidateObsCount) {
        return winner;
      }

      // Rule 3: Prefer most recently updated
      const winnerUpdated = new Date(winner.updatedAt).getTime();
      const candidateUpdated = new Date(candidate.updatedAt).getTime();

      if (candidateUpdated > winnerUpdated) {
        return candidate;
      }
      if (winnerUpdated > candidateUpdated) {
        return winner;
      }

      // Rule 4: Lexical tie-breaker (lowest _id)
      if (candidate._id < winner._id) {
        return candidate;
      }

      return winner;
    });
  }

  /**
   * Validate whether a merge is safe to proceed.
   * Returns { safe, warnings, blockers }.
   *
   * Checks:
   *   BLOCKER: Winner has 0 observations but any loser has >0
   *   BLOCKER: Any loser has >= MERGE_OBS_RATIO_THRESHOLD x winner's observations
   *   BLOCKER: Both first AND last name differ (both records fully populated)
   *   WARNING: Only first OR last name differs
   *   WARNING: Different currentCompany (not substring match)
   *
   * @param {Object} winner - Person document to keep
   * @param {Array} losers - Person documents to merge and delete
   * @returns {{ safe: boolean, warnings: string[], blockers: string[] }}
   */
  validateMergeSafety(winner, losers) {
    const warnings = [];
    const blockers = [];

    const winnerObsCount = winner.meta?.observationsCount || 0;

    for (const loser of losers) {
      const loserObsCount = loser.meta?.observationsCount || 0;

      // Observation disparity: winner has 0, loser has >0
      if (winnerObsCount === 0 && loserObsCount > 0) {
        blockers.push(
          `Winner ${winner._id} has 0 observations but loser ${loser._id} has ${loserObsCount}`,
        );
      }
      // Observation disparity: loser has >= threshold x winner's observations
      else if (
        winnerObsCount > 0 &&
        loserObsCount >= MERGE_OBS_RATIO_THRESHOLD * winnerObsCount
      ) {
        blockers.push(
          `Loser ${loser._id} has ${loserObsCount} observations vs winner ${winner._id} with ${winnerObsCount} (${Math.round(loserObsCount / winnerObsCount)}x ratio, threshold ${MERGE_OBS_RATIO_THRESHOLD}x)`,
        );
      }

      // Name comparison
      const wFirst = (winner.snapshot?.firstName || "").trim().toLowerCase();
      const wLast = (winner.snapshot?.lastName || "").trim().toLowerCase();
      const lFirst = (loser.snapshot?.firstName || "").trim().toLowerCase();
      const lLast = (loser.snapshot?.lastName || "").trim().toLowerCase();

      const firstPopulated = wFirst && lFirst;
      const lastPopulated = wLast && lLast;
      const firstDiffers = firstPopulated && wFirst !== lFirst;
      const lastDiffers = lastPopulated && wLast !== lLast;

      if (firstDiffers && lastDiffers) {
        blockers.push(
          `Name contradiction: winner "${winner.snapshot.firstName} ${winner.snapshot.lastName}" vs loser "${loser.snapshot.firstName} ${loser.snapshot.lastName}"`,
        );
      } else if (firstDiffers) {
        warnings.push(
          `First name mismatch: winner "${winner.snapshot.firstName}" vs loser "${loser.snapshot.firstName}"`,
        );
      } else if (lastDiffers) {
        warnings.push(
          `Last name mismatch: winner "${winner.snapshot.lastName}" vs loser "${loser.snapshot.lastName}"`,
        );
      }

      // Company mismatch
      const wCompany = (winner.snapshot?.currentCompany || "")
        .trim()
        .toLowerCase();
      const lCompany = (loser.snapshot?.currentCompany || "")
        .trim()
        .toLowerCase();

      if (wCompany && lCompany && wCompany !== lCompany) {
        // Allow substring match (e.g., "Google" and "Google LLC")
        if (!wCompany.includes(lCompany) && !lCompany.includes(wCompany)) {
          warnings.push(
            `Company mismatch: winner "${winner.snapshot.currentCompany}" vs loser "${loser.snapshot.currentCompany}"`,
          );
        }
      }
    }

    return {
      safe: blockers.length === 0,
      warnings,
      blockers,
    };
  }

  /**
   * Determine if canonical_id should be updated to a new value
   * Updates when the new ID is based on a higher-priority identifier
   *
   * Priority: salesNavId (10) > numericId (9) > linkedInUsername (8) > profileUrl (5) > publicUrl (4) > duxsoupId (1)
   *
   * @param {Object} person - Person document
   * @param {String} newCanonicalId - Proposed new canonical_id
   * @param {String} newPrimaryIdType - Type of identifier for new canonical_id
   * @returns {Boolean} True if canonical_id should be updated
   */
  shouldUpdateCanonicalId(person, newCanonicalId, newPrimaryIdType) {
    // If person has no canonical_id, always set it
    if (!person.canonical_id) {
      return true;
    }

    // If canonical IDs match, no update needed
    if (person.canonical_id === newCanonicalId) {
      return false;
    }

    // Priority mapping (higher = more stable)
    const priorities = {
      salesNavId: 10,
      numericId: 9,
      linkedInUsername: 8,
      vanityName: 7,
      profileUrl: 5,
      publicUrl: 4,
      salesUrl: 4,
      recruiterUrl: 4,
      duxsoupId: 1,
    };

    const newPriority = priorities[newPrimaryIdType] || 0;

    // Try to determine what type the existing canonical_id is based on
    // by checking each alias to see if it would produce the existing canonical_id
    for (const alias of person.aliases) {
      const testCanonicalKey = buildCanonicalKey(alias.type, alias.value);
      const testCanonicalId = computeCanonicalId(testCanonicalKey);

      if (testCanonicalId === person.canonical_id) {
        // Found the alias that created the existing canonical_id
        const existingPriority = priorities[alias.type] || 0;

        // Update if new priority is higher
        return newPriority > existingPriority;
      }
    }

    // If we can't determine the existing source, be conservative
    // Only update if the new ID is salesNavId (highest priority)
    return newPrimaryIdType === "salesNavId";
  }

  /**
   * Merge multiple people into a single canonical person
   * Combines aliases, observations, roles, education, skills
   * Deletes loser documents
   * Creates merge audit record
   *
   * @param {Object} winner - Person document to keep
   * @param {Array} losers - Person documents to merge and delete
   * @param {Object} mergeReason - { reason, sourceObservationId, force }
   * @returns {Promise<Object>} Updated winner person document
   */
  async mergePeople(winner, losers, mergeReason = {}) {
    if (!losers || losers.length === 0) {
      return winner;
    }

    try {
      logger.info("Merging people", {
        winner_id: winner._id,
        loser_ids: losers.map((l) => l._id),
        reason: mergeReason.reason || "alias_conflict",
      });

      // Safety validation (skip if force is set)
      if (!mergeReason.force) {
        const safetyResult = this.validateMergeSafety(winner, losers);

        if (safetyResult.blockers.length > 0) {
          logger.error("Merge blocked by safety validation", {
            winner_id: winner._id,
            loser_ids: losers.map((l) => l._id),
            blockers: safetyResult.blockers,
            warnings: safetyResult.warnings,
          });
          return winner;
        }

        if (safetyResult.warnings.length > 0) {
          logger.warn("Merge proceeding with safety warnings", {
            winner_id: winner._id,
            loser_ids: losers.map((l) => l._id),
            warnings: safetyResult.warnings,
          });
          mergeReason._safetyWarnings = safetyResult.warnings;
        }
      }

      // Capture winner state before merge for rollback
      mergeReason._winnerSnapshot = winner.toObject();

      // Collect all unique aliases
      const allAliases = [...winner.aliases];
      const aliasValues = new Set(allAliases.map((a) => a.value));

      losers.forEach((loser) => {
        loser.aliases.forEach((alias) => {
          if (!aliasValues.has(alias.value)) {
            allAliases.push(alias);
            aliasValues.add(alias.value);
          }
        });
      });

      // Collect all observation references (deduplicated, capped to MAX_OBSERVATION_REFS)
      const allVisits = new Set([...(winner.observations.visits || [])]);
      const allScans = new Set([...(winner.observations.scans || [])]);

      losers.forEach((loser) => {
        (loser.observations.visits || []).forEach((v) =>
          allVisits.add(v.toString()),
        );
        (loser.observations.scans || []).forEach((s) =>
          allScans.add(s.toString()),
        );
      });

      // Sum true observation counts from all entities
      const mergedObsCount = [winner, ...losers].reduce(
        (sum, entity) => sum + (entity.meta?.observationsCount || 0),
        0,
      );

      // Merge roles (deduplicate by title + company + dates)
      const roleKeys = new Set();
      const allRoles = [];

      const addRole = (role) => {
        const key = `${role.title}|${role.companyId}|${role.startDate}`;
        if (!roleKeys.has(key)) {
          roleKeys.add(key);
          allRoles.push(role);
        }
      };

      (winner.snapshot.roles || []).forEach(addRole);
      losers.forEach((loser) => {
        (loser.snapshot.roles || []).forEach(addRole);
      });

      // Merge education (deduplicate by school + degree)
      const eduKeys = new Set();
      const allEducation = [];

      const addEducation = (edu) => {
        const key = `${edu.school}|${edu.degree}|${edu.field}`;
        if (!eduKeys.has(key)) {
          eduKeys.add(key);
          allEducation.push(edu);
        }
      };

      (winner.snapshot.education || []).forEach(addEducation);
      losers.forEach((loser) => {
        (loser.snapshot.education || []).forEach(addEducation);
      });

      // Merge skills (deduplicate)
      const allSkills = new Set([...(winner.snapshot.skills || [])]);
      losers.forEach((loser) => {
        (loser.snapshot.skills || []).forEach((skill) => allSkills.add(skill));
      });

      // Update winner with merged data (cap observation arrays to MAX_OBSERVATION_REFS)
      winner.aliases = allAliases;
      const visitArr = Array.from(allVisits);
      const scanArr = Array.from(allScans);
      winner.observations.visits = visitArr.slice(-MAX_OBSERVATION_REFS);
      winner.observations.scans = scanArr.slice(-MAX_OBSERVATION_REFS);
      winner.snapshot.roles = allRoles;
      winner.snapshot.education = allEducation;
      winner.snapshot.skills = Array.from(allSkills);
      winner.meta = winner.meta || {};
      winner.meta.observationsCount = mergedObsCount;

      await winner.save();

      // Create merge audit record with rollback snapshots
      const Merge = require("../models/merge");
      const mergeAuditData = {
        winner_id: winner._id,
        loser_ids: losers.map((l) => l._id),
        reason: mergeReason.reason || "alias_conflict",
        sourceObservationId: mergeReason.sourceObservationId,
        timestamp: new Date(),
        winnerSnapshotBefore: mergeReason._winnerSnapshot || null,
        loserSnapshots: losers.map((l) => l.toObject()),
      };
      if (mergeReason._safetyWarnings?.length > 0) {
        mergeAuditData.metadata = {
          safetyWarnings: mergeReason._safetyWarnings,
        };
      }
      await Merge.create(mergeAuditData);

      // Delete loser documents
      const loserIds = losers.map((l) => l._id);
      await Person.deleteMany({ _id: { $in: loserIds } });

      logger.info("Successfully merged people", {
        winner_id: winner._id,
        merged_count: losers.length,
      });

      return winner;
    } catch (error) {
      logger.error("Failed to merge people", {
        winner_id: winner._id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Resolve or create canonical person from identity
   * Handles deduplication and merge scenarios
   *
   * @param {Object} identity - { person_id, aliases, source } from identityResolver
   * @param {Object} mergeReason - Optional merge context
   * @returns {Promise<Object>} Canonical person document
   */
  async resolveOrCreate(identity, mergeReason = {}) {
    if (!identity || !identity.person_id) {
      throw new Error("Identity must include person_id");
    }

    const canonicalKey =
      identity.canonical_key ||
      buildCanonicalKey(identity.primary_id_type, identity.person_id);
    const canonicalId =
      identity.canonical_id || computeCanonicalId(canonicalKey);

    if (!canonicalId) {
      throw new Error("Identity must include canonical_id");
    }

    try {
      // Step 1: Check if person exists by canonical_id (fastest path)
      let person = await Person.findOne({ canonical_id: canonicalId });

      if (person) {
        // Found exact match - merge any new aliases
        if (identity.aliases && identity.aliases.length > 0) {
          person = await this.mergeAliases(person, identity.aliases);
        }
        return person;
      }

      // Step 2: Search by aliases to find potential matches
      const matches = await this.findByAnyAlias(identity.aliases || []);

      if (matches.length === 0) {
        // No matches - create new person
        logger.info("Creating new person", {
          person_id: identity.person_id,
          source: identity.source,
        });

        person = await Person.create({
          _id: identity.person_id,
          canonical_id: canonicalId,
          aliases: identity.aliases || [],
          snapshot: {},
          observations: { visits: [], scans: [] },
        });

        return person;
      }

      if (matches.length === 1) {
        // Single match - merge aliases and return
        logger.info("Found existing person by alias", {
          person_id: matches[0]._id,
          matched_alias: identity.aliases?.[0]?.value,
        });

        person = matches[0];
        if (!person.canonical_id) {
          person.canonical_id = canonicalId;
          await person.save();
        } else if (person.canonical_id !== canonicalId) {
          // Check if we should update the canonical_id to a higher-priority one
          const shouldUpdate = this.shouldUpdateCanonicalId(
            person,
            canonicalId,
            identity.primary_id_type,
          );

          if (shouldUpdate) {
            logger.info("Updating canonical_id to higher-priority identifier", {
              person_id: person._id,
              old_canonical_id: person.canonical_id,
              new_canonical_id: canonicalId,
              new_primary_id_type: identity.primary_id_type,
            });

            person.canonical_id = canonicalId;
            await person.save();
          } else {
            logger.warn(
              "Canonical ID mismatch on alias match (keeping existing)",
              {
                person_id: person._id,
                existing_canonical_id: person.canonical_id,
                incoming_canonical_id: canonicalId,
                incoming_primary_id_type: identity.primary_id_type,
              },
            );
          }
        }

        person = await this.mergeAliases(person, identity.aliases || []);
        return person;
      }

      // Step 3: Multiple matches - merge scenario
      logger.warn("Multiple people match aliases - triggering merge", {
        person_id: identity.person_id,
        match_count: matches.length,
        matched_ids: matches.map((m) => m._id),
      });

      const canonicalMatches = matches.filter(
        (m) => m.canonical_id === canonicalId,
      );
      const winner =
        canonicalMatches.length > 0
          ? this.determineWinner(canonicalMatches)
          : this.determineWinner(matches);
      const losers = matches.filter((m) => m._id !== winner._id);

      if (!winner.canonical_id) {
        winner.canonical_id = canonicalId;
        await winner.save();
      } else if (winner.canonical_id !== canonicalId) {
        // Check if we should update the canonical_id to a higher-priority one
        const shouldUpdate = this.shouldUpdateCanonicalId(
          winner,
          canonicalId,
          identity.primary_id_type,
        );

        if (shouldUpdate) {
          logger.info(
            "Updating canonical_id to higher-priority identifier on merge",
            {
              winner_id: winner._id,
              old_canonical_id: winner.canonical_id,
              new_canonical_id: canonicalId,
              new_primary_id_type: identity.primary_id_type,
            },
          );

          winner.canonical_id = canonicalId;
          await winner.save();
        } else {
          logger.warn(
            "Canonical ID mismatch on merge winner (keeping existing)",
            {
              winner_id: winner._id,
              existing_canonical_id: winner.canonical_id,
              incoming_canonical_id: canonicalId,
              incoming_primary_id_type: identity.primary_id_type,
            },
          );
        }
      }

      person = await this.mergePeople(winner, losers, {
        reason: mergeReason.reason || "alias_conflict_detected",
        sourceObservationId: mergeReason.sourceObservationId,
      });

      // Merge new aliases into winner
      if (identity.aliases && identity.aliases.length > 0) {
        person = await this.mergeAliases(person, identity.aliases);
      }

      return person;
    } catch (error) {
      logger.error("Failed to resolve or create person", {
        person_id: identity.person_id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Find duplicate people grouped by salesNavId across the collection.
   * Uses the same Sales Navigator extraction logic as identityMatcher/salesNavIdExtractor.
   * After merges, a person can carry multiple salesNavIds and will appear in multiple groups.
   *
   * @returns {Promise<Array<{salesNavId: string, people: Array<Object>}>>}
   */
  async findSalesNavIdDuplicates() {
    const people = await Person.find({}, { _id: 1, aliases: 1 }).lean();
    const grouped = new Map();

    for (const person of people) {
      const salesNavIds = extractSalesNavIdsFromPersonRecord(person);
      if (salesNavIds.length === 0) {
        continue;
      }

      // Add person to group for EACH salesNavId it carries
      for (const salesNavId of salesNavIds) {
        const existing = grouped.get(salesNavId) || [];
        existing.push(person);
        grouped.set(salesNavId, existing);
      }
    }

    const duplicates = [];
    for (const [salesNavId, matches] of grouped.entries()) {
      if (matches.length > 1) {
        duplicates.push({ salesNavId, people: matches });
      }
    }

    return duplicates;
  }
}

const SALES_NAV_ID_PATTERN = /^AC[wo]AA[A-Za-z0-9_-]{10,}$/i;

/**
 * Extract all Sales Navigator IDs from a person record.
 * After merges, a person can carry multiple salesNavId aliases.
 * This function returns ALL of them to support duplicate detection.
 *
 * @param {Object} person - Person record with _id and aliases
 * @returns {Array<string>} Array of normalized salesNavIds (empty if none found)
 */
function extractSalesNavIdsFromPersonRecord(person) {
  if (!person) {
    return [];
  }

  const found = new Set();

  // Check _id
  if (person._id && SALES_NAV_ID_PATTERN.test(person._id)) {
    found.add(normalizeToCanonicalCase(person._id));
  }

  // Collect ALL explicit salesNavId aliases (not just the first)
  const aliases = person.aliases || [];
  aliases.forEach((alias) => {
    if (alias?.type === "salesNavId" && alias?.value) {
      found.add(normalizeToCanonicalCase(alias.value));
    }
  });

  // If no explicit salesNavIds found, try extracting from URLs
  if (found.size === 0) {
    const data = buildSalesNavExtractionData(aliases);
    const extracted = extractSalesNavId(data);
    if (extracted) {
      found.add(normalizeToCanonicalCase(extracted));
    }
  }

  return Array.from(found);
}

function buildSalesNavExtractionData(aliases = []) {
  const data = {};

  aliases.forEach((alias) => {
    if (!alias?.value) {
      return;
    }

    switch (alias.type) {
      case "salesUrl":
        data.salesUrl = alias.value;
        break;
      case "recruiterUrl":
        data.recruiterUrl = alias.value;
        break;
      case "profileUrl":
        data.profileUrl = alias.value;
        break;
      case "publicUrl":
        data.PublicProfile = alias.value;
        break;
      default:
        break;
    }
  });

  return data;
}

module.exports = new IdentityResolverService();
