const Location = require("../models/location");
const logger = require("../utils/logger");
const { resolveLocationIdentity } = require("../utils/identityResolver");
const { dedupeAliases } = require("../utils/aliasHelpers");

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

  let location = await Location.findOne({
    canonical_id: identity.canonical_id,
  });

  if (!location) {
    // Parse structured location fields from identity.parsed
    const parsed = identity.parsed || {};

    location = await Location.create({
      _id: identity.location_id,
      canonical_id: identity.canonical_id,
      aliases: dedupeAliases(identity.aliases),
      snapshot: {
        name: identity.normalized,
        normalized: identity.normalized,
        // Structured location fields from parser
        city: parsed.city || null,
        state: parsed.state || null,
        stateCode: parsed.stateCode || null,
        country: parsed.country || null,
        countryCode: parsed.countryCode || null,
        province: parsed.province || null,
        region: parsed.region || null,
        locationType: parsed.locationType || "unknown",
      },
      observations: { visits: [], scans: [] },
      meta: {},
    });
  } else {
    const mergedAliases = dedupeAliases([
      ...(location.aliases || []),
      ...(identity.aliases || []),
    ]);
    location.aliases = mergedAliases;
    location.snapshot = location.snapshot || {};
    location.snapshot.normalized =
      identity.normalized || location.snapshot.normalized;
    location.snapshot.name = identity.normalized || location.snapshot.name;

    // Update structured fields if parsed data is available
    if (identity.parsed) {
      const parsed = identity.parsed;
      location.snapshot.city = parsed.city || location.snapshot.city;
      location.snapshot.state = parsed.state || location.snapshot.state;
      location.snapshot.stateCode =
        parsed.stateCode || location.snapshot.stateCode;
      location.snapshot.country = parsed.country || location.snapshot.country;
      location.snapshot.countryCode =
        parsed.countryCode || location.snapshot.countryCode;
      location.snapshot.province =
        parsed.province || location.snapshot.province;
      location.snapshot.region = parsed.region || location.snapshot.region;
      location.snapshot.locationType =
        parsed.locationType || location.snapshot.locationType || "unknown";
    }
  }

  // Use $addToSet for atomic uniqueness on observation references
  const observationField =
    sourceType === "visit" ? "observations.visits" : "observations.scans";
  await Location.updateOne(
    { _id: location._id },
    { $addToSet: { [observationField]: observationId } },
  );

  // Reload to get updated observations count
  location = await Location.findById(location._id);

  location.meta = location.meta || {};
  location.meta.lastObservedAt = observedAt;
  location.meta.lastObservation = {
    type: sourceType,
    id: observationId,
    observedAt: observedAt,
  };
  location.meta.observationsCount =
    (location.observations.visits.length || 0) +
    (location.observations.scans.length || 0);

  await location.save();

  logger.info("Upserted location from observation", {
    location_id: location._id,
    canonical_id: location.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return location;
}

module.exports = {
  upsertLocationFromObservation,
};
