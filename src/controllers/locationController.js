const Location = require('../models/location');
const logger = require('../utils/logger');
const { resolveLocationIdentity } = require('../utils/identityResolver');
const { dedupeAliases } = require('../utils/aliasHelpers');

async function upsertLocationFromObservation(observationDoc, sourceType) {
  const webhookData = observationDoc.rawData || observationDoc;
  const locationValue = webhookData.Location;
  const identity = resolveLocationIdentity(locationValue);

  if (!identity.location_id || !identity.canonical_id) {
    return null;
  }

  const observedAt = webhookData.VisitTime || webhookData.ScanTime || new Date();
  const observationId = observationDoc._id;

  let location = await Location.findOne({ canonical_id: identity.canonical_id });

  if (!location) {
    location = await Location.create({
      _id: identity.location_id,
      canonical_id: identity.canonical_id,
      aliases: dedupeAliases(identity.aliases),
      snapshot: {
        name: identity.normalized,
        normalized: identity.normalized,
      },
      observations: { visits: [], scans: [] },
      meta: {},
    });
  } else {
    const mergedAliases = dedupeAliases([...(location.aliases || []), ...(identity.aliases || [])]);
    location.aliases = mergedAliases;
    location.snapshot = location.snapshot || {};
    location.snapshot.normalized = identity.normalized || location.snapshot.normalized;
    location.snapshot.name = identity.normalized || location.snapshot.name;
  }

  if (sourceType === 'visit' && !location.observations.visits.includes(observationId)) {
    location.observations.visits.push(observationId);
  }
  if (sourceType === 'scan' && !location.observations.scans.includes(observationId)) {
    location.observations.scans.push(observationId);
  }

  location.meta = location.meta || {};
  location.meta.lastObservedAt = observedAt;
  location.meta.lastObservation = {
    type: sourceType,
    id: observationId,
    observedAt: observedAt,
  };
  location.meta.observationsCount =
    (location.observations.visits.length || 0) + (location.observations.scans.length || 0);

  await location.save();

  logger.info('Upserted location from observation', {
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
