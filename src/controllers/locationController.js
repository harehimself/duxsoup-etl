const Location = require("../models/location");
const logger = require("../utils/logger");
const { resolveLocationIdentity } = require("../utils/identityMatcher");
const { dedupeAliases } = require("../utils/aliasHelpers");
const { shouldOverwrite } = require("../utils/precedence");
const { MAX_OBSERVATION_REFS } = require("../constants/limits");

async function upsertLocationFromObservation(observationDoc, sourceType) {
  // Extract data from nested rawData.data structure if present, otherwise use top-level fields
  const webhookData =
    observationDoc.rawData?.data || observationDoc.rawData || observationDoc;
  const locationValue = webhookData.Location;
  const identity = resolveLocationIdentity(locationValue);

  if (!identity.location_id || !identity.canonical_id) {
    logger.info("Cannot upsert location without stable ID", {
      observation_id: observationDoc._id,
      sourceType,
      location_value: locationValue || "empty",
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

  // Parse structured location fields from identity
  const parsed = identity.parsed || {};

  // Step 1: Atomic find-or-create — eliminates E11000 race between findOne + create
  const location = await Location.findOneAndUpdate(
    {
      $or: [
        { _id: identity.location_id },
        { canonical_id: identity.canonical_id },
      ],
    },
    {
      $setOnInsert: {
        _id: identity.location_id,
        canonical_id: identity.canonical_id,
        snapshot: {
          name: identity.normalized,
          normalized: identity.normalized,
          city: parsed.city || null,
          state: parsed.state || null,
          stateCode: parsed.stateCode || null,
          country: parsed.country || null,
          countryCode: parsed.countryCode || null,
          province: parsed.province || null,
          region: parsed.region || null,
          locationType: parsed.locationType || "unknown",
          usRegion: parsed.usRegion || null,
          usSubregion: parsed.usSubregion || null,
          timezone: parsed.timezone || null,
          utcOffset: parsed.utcOffset != null ? parsed.utcOffset : null,
        },
        observations: { visits: [], scans: [] },
        meta: {},
      },
    },
    { upsert: true, new: true },
  );

  // Step 2: Compute all updates from current state
  const $set = {};
  const snapshot = location.snapshot || {};

  // Merge aliases
  $set.aliases = dedupeAliases([
    ...(location.aliases || []),
    ...(identity.aliases || []),
  ]);

  // Apply snapshot fields with provenance (shouldOverwrite decides per-field)
  const existingMetaMap = snapshot._meta || {};

  // Core fields
  const snapshotFields = [
    ["normalized", identity.normalized],
    ["name", identity.normalized],
  ];

  // Parsed location fields
  if (identity.parsed) {
    snapshotFields.push(
      ["city", parsed.city],
      ["state", parsed.state],
      ["stateCode", parsed.stateCode],
      ["country", parsed.country],
      ["countryCode", parsed.countryCode],
      ["province", parsed.province],
      ["region", parsed.region],
      ["locationType", parsed.locationType],
      ["usRegion", parsed.usRegion],
      ["usSubregion", parsed.usSubregion],
      ["timezone", parsed.timezone],
      ["utcOffset", parsed.utcOffset],
    );
  }

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

  // Pre-check: is this observation already linked?
  const observationField =
    sourceType === "visit" ? "observations.visits" : "observations.scans";
  const obsArray =
    sourceType === "visit"
      ? location.observations.visits
      : location.observations.scans;
  const isAlreadyLinked = obsArray.some(
    (id) => id.toString() === observationId.toString(),
  );

  // Step 3: Single atomic update — $set + $push (capped) + $inc in one operation
  const updated = await Location.findOneAndUpdate(
    { _id: location._id },
    {
      $set,
      $push: {
        [observationField]: {
          $each: [observationId],
          $slice: -MAX_OBSERVATION_REFS,
        },
      },
      $inc: { "meta.observationsCount": isAlreadyLinked ? 0 : 1 },
    },
    { new: true },
  );

  logger.info("Upserted location from observation", {
    location_id: updated._id,
    canonical_id: updated.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return updated;
}

module.exports = {
  upsertLocationFromObservation,
};
