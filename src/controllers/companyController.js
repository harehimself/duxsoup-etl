const Company = require("../models/company");
const logger = require("../utils/logger");
const { resolveCompanyIdentity } = require("../utils/identityMatcher");
const { dedupeAliases } = require("../utils/aliasHelpers");
const { parseLocation } = require("../utils/location-parser");
const { shouldOverwrite } = require("../utils/precedence");

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

  // Step 1: Atomic find-or-create — eliminates E11000 race between findOne + create
  const company = await Company.findOneAndUpdate(
    {
      $or: [
        { _id: identity.company_id },
        { canonical_id: identity.canonical_id },
      ],
    },
    {
      $setOnInsert: {
        _id: identity.company_id,
        canonical_id: identity.canonical_id,
        snapshot: {},
        observations: { visits: [], scans: [] },
        meta: {},
      },
    },
    { upsert: true, new: true },
  );

  // Step 2: Compute all updates from current state
  const $set = {};
  const snapshot = company.snapshot || {};

  // Merge aliases
  $set.aliases = dedupeAliases([
    ...(company.aliases || []),
    ...(identity.aliases || []),
  ]);

  // Parse structured location fields from raw location string.
  // DuxSoup webhooks provide the person's Location, which serves as
  // a proxy for the company's location (best available signal).
  const parsedLocation = webhookData.Location
    ? parseLocation(webhookData.Location)
    : {};

  // Apply snapshot fields with provenance (shouldOverwrite decides per-field)
  const snapshotFields = [
    ["name", webhookData.Company],
    ["industry", webhookData.Industry],
    ["location", webhookData.Location],
    ["companyProfileUrl", webhookData.CompanyProfile],
    ["website", webhookData.CompanyWebsite],
    // Structured location fields (parsed from person's Location as proxy)
    ["city", parsedLocation.city],
    ["state", parsedLocation.state],
    ["stateCode", parsedLocation.stateCode],
    ["country", parsedLocation.country],
    ["countryCode", parsedLocation.countryCode],
    ["province", parsedLocation.province],
    ["region", parsedLocation.region],
    ["locationType", parsedLocation.locationType],
    ["usRegion", parsedLocation.usRegion],
    ["usSubregion", parsedLocation.usSubregion],
    ["timezone", parsedLocation.timezone],
    ["utcOffset", parsedLocation.utcOffset],
  ];

  const existingMetaMap = snapshot._meta || {};

  for (const [field, value] of snapshotFields) {
    const existing = existingMetaMap[field];
    const incoming = { value, ...observationMeta };

    if (shouldOverwrite(existing, incoming)) {
      $set[`snapshot.${field}`] = value;
      $set[`snapshot._meta.${field}`] = {
        value,
        observedAt: observationMeta.observedAt,
        source: observationMeta.source,
        observationId: observationMeta.observationId,
      };
    }
  }

  // Meta fields
  $set["meta.lastObservedAt"] = observedAt;
  $set["meta.lastObservation"] = {
    type: sourceType,
    id: observationId,
    observedAt,
  };

  // Pre-compute observations count (account for the $addToSet below)
  const observationField =
    sourceType === "visit" ? "observations.visits" : "observations.scans";
  const obsArray =
    sourceType === "visit"
      ? company.observations.visits
      : company.observations.scans;
  const isAlreadyLinked = obsArray.some(
    (id) => id.toString() === observationId.toString(),
  );
  $set["meta.observationsCount"] =
    (company.observations.visits?.length || 0) +
    (company.observations.scans?.length || 0) +
    (isAlreadyLinked ? 0 : 1);

  // Step 3: Single atomic update — $set + $addToSet in one operation
  const updated = await Company.findOneAndUpdate(
    { _id: company._id },
    {
      $set,
      $addToSet: { [observationField]: observationId },
    },
    { new: true },
  );

  logger.info("Upserted company from observation", {
    company_id: updated._id,
    canonical_id: updated.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return updated;
}

module.exports = {
  upsertCompanyFromObservation,
};
