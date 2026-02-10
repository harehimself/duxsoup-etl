const Company = require("../models/company");
const logger = require("../utils/logger");
const { resolveCompanyIdentity } = require("../utils/identityMatcher");
const { dedupeAliases } = require("../utils/aliasHelpers");

/**
 * Source precedence: visit > scan (matches person controller)
 */
const SOURCE_PRECEDENCE = { visit: 2, scan: 1 };

/**
 * Determine whether an incoming value should overwrite an existing one.
 * Applies the same rules as the person controller:
 *   1. Always accept if no existing value
 *   2. Never overwrite with empty/blank
 *   3. visit beats scan
 *   4. Same source: newer beats older
 */
function shouldOverwrite(existingMeta, incomingMeta) {
  // Never overwrite with empty/null/blank — check BEFORE missing-meta guard
  // to prevent erasing existing data on legacy records that lack _meta
  const v = incomingMeta.value;
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;

  if (
    !existingMeta ||
    existingMeta.value === null ||
    existingMeta.value === undefined
  ) {
    return true;
  }

  const existingP = SOURCE_PRECEDENCE[existingMeta.source] || 0;
  const incomingP = SOURCE_PRECEDENCE[incomingMeta.source] || 0;

  if (incomingP > existingP) return true;
  if (incomingP < existingP) return false;

  // Same precedence: newer wins
  const existingTime = new Date(existingMeta.observedAt).getTime();
  const incomingTime = new Date(incomingMeta.observedAt).getTime();
  return incomingTime >= existingTime;
}

/**
 * Apply a snapshot field with provenance tracking (_meta).
 *
 * @param {Object} snapshot - Company snapshot subdocument
 * @param {string} field    - Field name (e.g. 'name')
 * @param {*}      value    - Incoming value
 * @param {Object} meta     - { observedAt, source, observationId }
 * @returns {boolean} True if value was updated
 */
function applySnapshotField(snapshot, field, value, meta) {
  const existingMeta = snapshot._meta?.[field];
  const incomingMeta = { value, ...meta };

  if (!shouldOverwrite(existingMeta, incomingMeta)) {
    return false;
  }

  snapshot[field] = value;

  if (!snapshot._meta) snapshot._meta = {};
  snapshot._meta[field] = {
    value,
    observedAt: meta.observedAt,
    source: meta.source,
    observationId: meta.observationId,
  };

  return true;
}

/**
 * Deep-clone a snapshot object, preserving Date and ObjectId types.
 * Avoids Mongoose dirty-tracking side-effects during local computation.
 */
function cloneSnapshot(snapshot) {
  if (!snapshot) return {};
  const raw =
    typeof snapshot.toObject === "function" ? snapshot.toObject() : snapshot;
  const clone = { ...raw };
  if (raw._meta && typeof raw._meta === "object") {
    clone._meta = {};
    for (const [key, val] of Object.entries(raw._meta)) {
      clone._meta[key] = { ...val };
    }
  }
  return clone;
}

async function upsertCompanyFromObservation(observationDoc, sourceType) {
  // Extract data from nested rawData.data structure if present, otherwise use top-level fields
  const webhookData =
    observationDoc.rawData?.data || observationDoc.rawData || observationDoc;
  const identity = resolveCompanyIdentity(webhookData);

  if (!identity.company_id || !identity.canonical_id) {
    logger.info("Cannot upsert company without stable ID", {
      observation_id: observationDoc._id,
      sourceType,
      company_name: webhookData.Company || "unknown",
    });
    return null;
  }

  const observedAt =
    webhookData.VisitTime || webhookData.ScanTime || new Date();
  const observationId = observationDoc._id;
  const observationMeta = {
    observedAt,
    source: sourceType,
    observationId,
  };

  // Step 1: Find or create the base document
  let company = await Company.findOne({
    $or: [
      { _id: identity.company_id },
      { canonical_id: identity.canonical_id },
    ],
  });

  if (!company) {
    try {
      company = await Company.create({
        _id: identity.company_id,
        canonical_id: identity.canonical_id,
        aliases: dedupeAliases(identity.aliases),
        snapshot: {},
        observations: { visits: [], scans: [] },
        meta: {},
      });
    } catch (err) {
      if (err.code === 11000) {
        // Race condition: another request inserted this company between our find and create
        company = await Company.findById(identity.company_id);
        if (!company) {
          throw err; // Unexpected: duplicate key but document not found
        }
      } else {
        throw err;
      }
    }
  }

  // Step 2: Compute all changes locally
  const mergedAliases = dedupeAliases([
    ...(company.aliases || []),
    ...(identity.aliases || []),
  ]);

  const snapshot = cloneSnapshot(company.snapshot);
  applySnapshotField(snapshot, "name", webhookData.Company, observationMeta);
  applySnapshotField(
    snapshot,
    "industry",
    webhookData.Industry,
    observationMeta,
  );
  applySnapshotField(
    snapshot,
    "companyProfileUrl",
    webhookData.CompanyProfile,
    observationMeta,
  );
  applySnapshotField(
    snapshot,
    "website",
    webhookData.CompanyWebsite,
    observationMeta,
  );

  // Pre-compute observation count (avoids needing a separate reload)
  const existingObs =
    sourceType === "visit"
      ? company.observations?.visits || []
      : company.observations?.scans || [];
  const isNewObs = !existingObs.some(
    (id) => String(id) === String(observationId),
  );
  const observationsCount =
    (company.observations?.visits?.length || 0) +
    (company.observations?.scans?.length || 0) +
    (isNewObs ? 1 : 0);

  // Step 3: Single atomic update (eliminates find-modify-save race condition)
  const obsField =
    sourceType === "visit" ? "observations.visits" : "observations.scans";

  const updated = await Company.findOneAndUpdate(
    { _id: company._id },
    {
      $set: {
        aliases: mergedAliases,
        snapshot,
        "meta.lastObservedAt": observedAt,
        "meta.lastObservation": {
          type: sourceType,
          id: observationId,
          observedAt: observedAt,
        },
        "meta.observationsCount": observationsCount,
      },
      $addToSet: { [obsField]: observationId },
    },
    { new: true },
  );

  logger.info("Upserted company from observation", {
    company_id: updated?._id,
    canonical_id: updated?.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return updated;
}

module.exports = {
  upsertCompanyFromObservation,
};
