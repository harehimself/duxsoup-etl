const logger = require("../utils/logger");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError,
} = require("../utils/validation");
const { validateAndLogSchema } = require("../utils/webhookSchemaValidator");
const { getConfig } = require("../utils/env");
const { computeEventKey } = require("../utils/eventKey");
const { upsertFromObservation } = require("./personController");
const { upsertCompanyFromObservation } = require("./companyController");
const { upsertLocationFromObservation } = require("./locationController");
const DeadLetter = require("../models/deadLetter");
const { resolvePersonIdentity } = require("../utils/identityMatcher");
const { shouldSkip } = require("../utils/upsertDebounce");
const throughputTracker = require("../utils/throughputTracker");
const { createCollector } = require("../utils/warningCollector");

/**
 * Core observation processing logic, independent of Express req/res.
 *
 * @param {Object} config - Type-specific configuration (model, type, timeField, requiredFields, dataMapper)
 * @param {Object} payload - Raw webhook payload (the request body)
 * @returns {Promise<{success: boolean, status: number, data?: Object, error?: string, message?: string}>}
 */
async function processObservationPayload(config, payload) {
  const startTime = Date.now();
  const trackingEvent = {
    type: config.type,
    success: false,
    debounced: false,
    duplicate: false,
    phase2Failure: false,
  };

  const envConfig = getConfig();
  const collector = createCollector();

  // Schema drift detection (warn-only, never blocks processing)
  const schemaResult = validateAndLogSchema(payload);
  if (schemaResult.typeErrors.length > 0) {
    schemaResult.typeErrors.forEach((err) => {
      collector.add("SCHEMA_TYPE_VIOLATION", err, { field: "schema" });
    });
  }
  if (schemaResult.unknownFields.length > 0) {
    schemaResult.unknownFields.forEach((uf) => {
      collector.add(
        "SCHEMA_UNKNOWN_FIELD",
        `Unknown field: ${uf.path}.${uf.key}`,
        {
          field: "schema",
          details: { path: uf.path, key: uf.key },
        },
      );
    });
  }

  try {
    // Validate webhook payload structure
    const payloadValidation = validateWebhookPayload(payload, config.type);
    if (!payloadValidation.isValid) {
      return {
        success: false,
        status: 400,
        error: payloadValidation.error,
        data: createErrorResponse(payloadValidation.error),
      };
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
      return {
        success: false,
        status: 400,
        error: fieldsValidation.error,
        data: createErrorResponse(fieldsValidation.error, {
          missingFields: fieldsValidation.missingFields,
          required: config.requiredFields,
        }),
      };
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
      const result = await config.model.findOneAndUpdate(
        { event_key: eventKey },
        { $setOnInsert: dataToSave },
        {
          returnDocument: "after",
          upsert: true,
          runValidators: true,
          includeResultMetadata: true,
        },
      );

      observation = result.value;
      // lastErrorObject.upserted is present only when a new document was inserted
      isDuplicate = !result.lastErrorObject?.upserted;

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
          return {
            success: false,
            status: 500,
            error: "Duplicate detection failed",
            data: { error: "Duplicate detection failed" },
          };
        }
      } else {
        // Other DB error - fail the webhook
        const errorResponse = handleDatabaseError(
          dbError,
          config.type,
          profileData.id,
          envConfig.isProduction,
        );
        return {
          success: false,
          status: 500,
          error: errorResponse.error || "Database error",
          data: errorResponse,
        };
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
        collector.add("DEBOUNCED", "Entity upserts skipped (debounced)", {
          details: { duxsoupId: debounceKey },
        });
        peopleUpsertSuccess = true;
      } else {
        try {
          const personResult = await upsertFromObservation(
            observation,
            config.type,
            collector,
          );
          peopleUpsertSuccess = personResult !== null;

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
            collector.add(
              "COMPANY_UPSERT_FAILED",
              `Company upsert failed: ${companyError.message}`,
              {
                details: { error: companyError.message },
              },
            );
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
            collector.add(
              "LOCATION_UPSERT_FAILED",
              `Location upsert failed: ${locationError.message}`,
              {
                details: { error: locationError.message },
              },
            );
          }
        } catch (peopleError) {
          // Log failure but DON'T fail the webhook
          logger.error(`Failed to upsert person from ${config.type}`, {
            observation_id: observation._id,
            event_key: eventKey,
            error: peopleError.message,
            stack: peopleError.stack,
          });
          collector.add(
            "PERSON_UPSERT_FAILED",
            `Person upsert failed: ${peopleError.message}`,
            {
              details: { error: peopleError.message },
            },
          );

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

    // Build success response
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
    response.warnings = collector.getAll();

    // Track throughput
    trackingEvent.success = true;
    trackingEvent.duplicate = isDuplicate;
    trackingEvent.debounced = debounced;
    trackingEvent.phase2Failure = !peopleUpsertSuccess;

    // Feed warning metrics to throughput tracker
    const allWarnings = collector.getAll();
    if (allWarnings.length > 0) {
      trackingEvent.warningCount = allWarnings.length;
      trackingEvent.warningsByCode = {};
      for (const w of allWarnings) {
        trackingEvent.warningsByCode[w.code] =
          (trackingEvent.warningsByCode[w.code] || 0) + 1;
      }
    }

    return { success: true, status: 200, data: response };
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

    return {
      success: false,
      status: 500,
      error: errorResponse.error,
      data: errorResponse,
    };
  } finally {
    trackingEvent.latencyMs = Date.now() - startTime;
    throughputTracker.record(trackingEvent);
  }
}

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
  const result = await processObservationPayload(config, req.body);
  res.status(result.status).json(result.data);
}

module.exports = { handleObservation, processObservationPayload };
