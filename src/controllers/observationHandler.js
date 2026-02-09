const logger = require("../utils/logger");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError,
} = require("../utils/validation");
const { getConfig } = require("../utils/env");
const { computeEventKey } = require("../utils/eventKey");
const { upsertFromObservation } = require("./personController");
const { upsertCompanyFromObservation } = require("./companyController");
const { upsertLocationFromObservation } = require("./locationController");
const DeadLetter = require("../models/deadLetter");
const { resolvePersonIdentity } = require("../utils/identityMatcher");
const { shouldSkip } = require("../utils/upsertDebounce");

/**
 * Generic observation handler for Visit and Scan webhooks
 * Eliminates 500 lines of duplicate code between controllers
 *
 * @param {Object} config - Type-specific configuration
 * @param {Object} config.model - Mongoose model (Visit or Scan)
 * @param {string} config.type - Observation type ('visit' or 'scan')
 * @param {string} config.timeField - Time field name in webhook ('VisitTime' or 'ScanTime')
 * @param {Array<string>} config.requiredFields - Required fields for validation
 * @param {Function} config.dataMapper - Function to map profileData to observation document
 */
async function handleObservation(config, req, res) {
  const payload = req.body;
  const envConfig = getConfig();

  try {
    // Validate webhook payload structure
    const payloadValidation = validateWebhookPayload(payload, config.type);
    if (!payloadValidation.isValid) {
      return res.status(400).json(createErrorResponse(payloadValidation.error));
    }

    const profileData = payloadValidation.profileData;

    logger.info(`Processing ${config.type} data`, {
      id: profileData.id,
      profile: profileData.Profile,
    });

    // Validate required fields
    const fieldsValidation = validateRequiredFields(
      profileData,
      config.requiredFields,
      config.type,
    );

    if (!fieldsValidation.isValid) {
      return res.status(400).json(
        createErrorResponse(fieldsValidation.error, {
          missingFields: fieldsValidation.missingFields,
          required: config.requiredFields,
        }),
      );
    }

    // Compute idempotency key (Guardrail: prevents duplicate observations)
    const eventKey = computeEventKey(payload);

    // Map profileData to observation document using type-specific mapper
    const dataToSave = config.dataMapper(profileData, payload, eventKey);

    // PHASE 1: Write to observation collection (legacy, system-of-record)
    // This MUST succeed for webhook to return success
    let observation;
    let isDuplicate = false;

    try {
      // Use event_key for idempotency
      observation = await config.model.findOneAndUpdate(
        { event_key: eventKey },
        { $setOnInsert: dataToSave },
        {
          new: true,
          upsert: true,
          runValidators: true,
        },
      );

      // First insert - not a duplicate
      isDuplicate = false;

      logger.info(`${config.type} data processed in MongoDB`, {
        id: observation._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        isDuplicate,
        event_key: eventKey,
      });
    } catch (dbError) {
      // E11000 duplicate key error - webhook retried, find existing observation
      if (dbError.code === 11000 && dbError.keyPattern?.event_key) {
        logger.info(
          "Duplicate event_key detected, returning existing observation",
          {
            event_key: eventKey,
            type: config.type,
          },
        );

        observation = await config.model.findOne({ event_key: eventKey });
        isDuplicate = true;

        if (!observation) {
          // Race condition - retry once
          observation = await config.model.findOne({ event_key: eventKey });
        }

        if (!observation) {
          // Should never happen, but log and fail
          logger.error(`E11000 but cannot find ${config.type} by event_key`, {
            event_key: eventKey,
          });
          return res.status(500).json({ error: "Duplicate detection failed" });
        }
      } else {
        // Other DB error - fail the webhook
        const errorResponse = handleDatabaseError(
          dbError,
          config.type,
          profileData.id,
          envConfig.isProduction,
        );
        return res.status(500).json(errorResponse);
      }
    }

    // PHASE 2: Dual-write to people/company/location collections (new system)
    // Failures here are logged but don't fail the webhook
    // Skip if this is a duplicate (already processed)
    let peopleUpsertSuccess = false;
    let companyUpsertSuccess = false;
    let locationUpsertSuccess = false;
    let debounced = false;

    if (isDuplicate) {
      logger.info("Skipping entity upserts for duplicate event", {
        observation_id: observation._id,
        event_key: eventKey,
        type: config.type,
      });
      peopleUpsertSuccess = true; // Already processed before
    } else {
      // Debounce: skip Phase 2 if the same duxsoupId was processed recently
      const debounceKey = profileData.id;
      debounced = debounceKey ? shouldSkip(debounceKey) : false;

      if (debounced) {
        logger.info("Skipping entity upserts (debounced)", {
          duxsoupId: debounceKey,
          observation_id: observation._id,
          event_key: eventKey,
          type: config.type,
        });
        peopleUpsertSuccess = true;
      } else {
        try {
          await upsertFromObservation(observation, config.type);
          peopleUpsertSuccess = true;

          logger.info(`Person upserted from ${config.type}`, {
            observation_id: observation._id,
            event_key: eventKey,
          });

          // Upsert company
          try {
            await upsertCompanyFromObservation(observation, config.type);
            companyUpsertSuccess = true;
          } catch (companyError) {
            logger.error(`Failed to upsert company from ${config.type}`, {
              observation_id: observation._id,
              event_key: eventKey,
              error: companyError.message,
            });
          }

          // Upsert location
          try {
            await upsertLocationFromObservation(observation, config.type);
            locationUpsertSuccess = true;
          } catch (locationError) {
            logger.error(`Failed to upsert location from ${config.type}`, {
              observation_id: observation._id,
              event_key: eventKey,
              error: locationError.message,
            });
          }
        } catch (peopleError) {
          // Log failure but DON'T fail the webhook
          logger.error(`Failed to upsert person from ${config.type}`, {
            observation_id: observation._id,
            event_key: eventKey,
            error: peopleError.message,
            stack: peopleError.stack,
          });

          // Write to dead_letters for replay
          try {
            const identityHints = resolvePersonIdentity(payload);
            await DeadLetter.createFromFailure(
              observation._id,
              config.type,
              peopleError,
              identityHints,
              payload,
            );

            logger.info("Logged failed person upsert to dead_letters", {
              observation_id: observation._id,
              event_key: eventKey,
              type: config.type,
            });
          } catch (deadLetterError) {
            // If dead_letter fails, just log - don't block webhook
            logger.error("Failed to log to dead_letters", {
              observation_id: observation._id,
              error: deadLetterError.message,
            });
          }
        }
      } // end !debounced
    }

    // Always return success if legacy write succeeded
    const response = createSuccessResponse(
      config.type,
      observation,
      profileData,
    );
    response.people_upsert = peopleUpsertSuccess;
    response.company_upsert = companyUpsertSuccess;
    response.location_upsert = locationUpsertSuccess;
    response.duplicate = isDuplicate;
    response.debounced = debounced;

    res.status(200).json(response);
  } catch (error) {
    logger.error(`Error processing ${config.type} data:`, {
      error: error.message,
      stack: error.stack,
    });

    const errorResponse = {
      error: `Failed to process ${config.type} data`,
      message: error.message,
    };

    // Don't expose stack traces in production
    if (!envConfig.isProduction && error.stack) {
      errorResponse.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
}

module.exports = { handleObservation };
