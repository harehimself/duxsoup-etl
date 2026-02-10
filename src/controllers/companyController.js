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
  if (
    !existingMeta ||
    existingMeta.value === null ||
    existingMeta.value === undefined
  ) {
    return true;
  }

  const v = incomingMeta.value;
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;

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

  // Always merge aliases
  {
    const mergedAliases = dedupeAliases([
      ...(company.aliases || []),
      ...(identity.aliases || []),
    ]);
    company.aliases = mergedAliases;
  }

  // Use $addToSet for atomic uniqueness on observation references
  const observationField =
    sourceType === "visit" ? "observations.visits" : "observations.scans";
  await Company.updateOne(
    { _id: company._id },
    { $addToSet: { [observationField]: observationId } },
  );

  // Reload to get updated observations count
  company = await Company.findById(company._id);

  company.meta = company.meta || {};
  company.meta.lastObservedAt = observedAt;
  company.meta.lastObservation = {
    type: sourceType,
    id: observationId,
    observedAt: observedAt,
  };
  company.meta.observationsCount =
    (company.observations.visits.length || 0) +
    (company.observations.scans.length || 0);

  company.snapshot = company.snapshot || {};
  applySnapshotField(
    company.snapshot,
    "name",
    webhookData.Company,
    observationMeta,
  );
  applySnapshotField(
    company.snapshot,
    "industry",
    webhookData.Industry,
    observationMeta,
  );
  applySnapshotField(
    company.snapshot,
    "companyProfileUrl",
    webhookData.CompanyProfile,
    observationMeta,
  );
  applySnapshotField(
    company.snapshot,
    "website",
    webhookData.CompanyWebsite,
    observationMeta,
  );

  await company.save();

  logger.info("Upserted company from observation", {
    company_id: company._id,
    canonical_id: company.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return company;
}

module.exports = {
  upsertCompanyFromObservation,
};
