const Location = require("../models/location");
const logger = require("../utils/logger");
const { resolveLocationIdentity } = require("../utils/identityMatcher");
const { dedupeAliases } = require("../utils/aliasHelpers");

/**
 * Source precedence: visit > scan (matches person/company controllers)
 */
const SOURCE_PRECEDENCE = { visit: 2, scan: 1 };

/**
 * Determine whether an incoming value should overwrite an existing one.
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

  const existingTime = new Date(existingMeta.observedAt).getTime();
  const incomingTime = new Date(incomingMeta.observedAt).getTime();
  return incomingTime >= existingTime;
}

/**
 * Apply a snapshot field with provenance tracking (_meta).
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

  // Step 1: Find or create the base document
  let location = await Location.findOne({
    $or: [
      { _id: identity.location_id },
      { canonical_id: identity.canonical_id },
    ],
  });

  if (!location) {
    // Parse structured location fields from identity.parsed
    const parsed = identity.parsed || {};

    try {
      location = await Location.create({
        _id: identity.location_id,
        canonical_id: identity.canonical_id,
        aliases: dedupeAliases(identity.aliases),
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
        },
        observations: { visits: [], scans: [] },
        meta: {},
      });
    } catch (err) {
      if (err.code === 11000) {
        location = await Location.findById(identity.location_id);
        if (!location) {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  // Step 2: Compute all changes locally
  const mergedAliases = dedupeAliases([
    ...(location.aliases || []),
    ...(identity.aliases || []),
  ]);

  const snapshot = cloneSnapshot(location.snapshot);
  applySnapshotField(
    snapshot,
    "normalized",
    identity.normalized,
    observationMeta,
  );
  applySnapshotField(snapshot, "name", identity.normalized, observationMeta);

  if (identity.parsed) {
    const parsed = identity.parsed;
    const fields = [
      ["city", parsed.city],
      ["state", parsed.state],
      ["stateCode", parsed.stateCode],
      ["country", parsed.country],
      ["countryCode", parsed.countryCode],
      ["province", parsed.province],
      ["region", parsed.region],
      ["locationType", parsed.locationType],
    ];
    for (const [field, value] of fields) {
      applySnapshotField(snapshot, field, value, observationMeta);
    }
  }

  // Pre-compute observation count (avoids needing a separate reload)
  const existingObs =
    sourceType === "visit"
      ? location.observations?.visits || []
      : location.observations?.scans || [];
  const isNewObs = !existingObs.some(
    (id) => String(id) === String(observationId),
  );
  const observationsCount =
    (location.observations?.visits?.length || 0) +
    (location.observations?.scans?.length || 0) +
    (isNewObs ? 1 : 0);

  // Step 3: Single atomic update (eliminates find-modify-save race condition)
  const obsField =
    sourceType === "visit" ? "observations.visits" : "observations.scans";

  const updated = await Location.findOneAndUpdate(
    { _id: location._id },
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

  logger.info("Upserted location from observation", {
    location_id: updated?._id,
    canonical_id: updated?.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return updated;
}

module.exports = {
  upsertLocationFromObservation,
};
