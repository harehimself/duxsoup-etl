const Visit = require("../models/visit");
const Scan = require("../models/scan");
const { upsertFromObservation } = require("./personController");
const { upsertCompanyFromObservation } = require("./companyController");
const { upsertLocationFromObservation } = require("./locationController");
const logger = require("../utils/logger");

/**
 * Replay Controller
 *
 * Re-processes an existing observation through the Phase 2 snapshot pipeline.
 * Useful for recovering from ETL bugs without re-ingesting data.
 */

/**
 * POST /api/admin/replay/:observationId?type=visit|scan
 *
 * Replays an observation through the person snapshot upsert pipeline.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function replayObservation(req, res) {
  try {
    const { observationId } = req.params;
    const { type } = req.query;

    if (!type || !["visit", "scan"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_TYPE",
        message:
          'Query parameter "type" is required and must be "visit" or "scan"',
      });
    }

    logger.info("Replaying observation", { observationId, type });

    // Look up the observation
    const Model = type === "visit" ? Visit : Scan;
    const observation = await Model.findById(observationId);

    if (!observation) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: `${type} observation not found: ${observationId}`,
      });
    }

    // Re-process through snapshot pipeline
    const person = await upsertFromObservation(observation, type);

    if (!person) {
      return res.status(422).json({
        success: false,
        error: "UPSERT_SKIPPED",
        message:
          "Observation lacks stable identity — person upsert was skipped",
      });
    }

    // Best-effort company upsert
    let company_replayed = false;
    try {
      const company = await upsertCompanyFromObservation(observation, type);
      company_replayed = company != null;
    } catch (companyErr) {
      logger.warn("Company upsert failed during replay (non-blocking)", {
        observationId,
        error: companyErr.message,
      });
    }

    // Best-effort location upsert
    let location_replayed = false;
    try {
      const location = await upsertLocationFromObservation(observation, type);
      location_replayed = location != null;
    } catch (locationErr) {
      logger.warn("Location upsert failed during replay (non-blocking)", {
        observationId,
        error: locationErr.message,
      });
    }

    logger.info("Observation replayed successfully", {
      observationId,
      type,
      person_id: person._id,
      company_replayed,
      location_replayed,
    });

    res.json({
      success: true,
      data: {
        person_id: person._id,
        replayed: true,
        company_replayed,
        location_replayed,
        observationId,
        type,
      },
    });
  } catch (error) {
    logger.error("Failed to replay observation", {
      observationId: req.params.observationId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: "REPLAY_FAILED",
      message: error.message,
    });
  }
}

module.exports = {
  replayObservation,
};
