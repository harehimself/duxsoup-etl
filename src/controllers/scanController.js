const logger = require("../utils/logger");
const Scan = require("../models/scan");
const {
  validateWebhookPayload,
  validateRequiredFields,
  createErrorResponse,
  createSuccessResponse,
  handleDatabaseError
} = require("../utils/validation");
const { getConfig } = require("../utils/env");
const { computeEventKey } = require("../utils/eventKey");
const { upsertFromObservation } = require("./personController");
const DeadLetter = require("../models/deadLetter");
const { resolvePersonIdentity } = require("../utils/identityResolver");

const handleScan = async (req, res) => {
  try {
    const payload = req.body;
    const config = getConfig();

    // Validate webhook payload structure
    const payloadValidation = validateWebhookPayload(payload, 'scan');
    if (!payloadValidation.isValid) {
      return res.status(400).json(createErrorResponse(payloadValidation.error));
    }

    const profileData = payloadValidation.profileData;

    logger.info("Processing scan data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    // Validate required fields
    const requiredFields = ["ScanTime", "Profile", "First Name", "Last Name"];
    const fieldsValidation = validateRequiredFields(profileData, requiredFields, 'scan');

    if (!fieldsValidation.isValid) {
      return res.status(400).json(
        createErrorResponse(fieldsValidation.error, {
          missingFields: fieldsValidation.missingFields,
          required: requiredFields
        })
      );
    }

    // Compute idempotency key (Guardrail: prevents duplicate observations)
    const eventKey = computeEventKey(payload);

    const scanDataToSave = {
      id: profileData.id,
      ScanTime: new Date(profileData.ScanTime),
      Profile: profileData.Profile,
      "First Name": profileData["First Name"],
      "Last Name": profileData["Last Name"],
      "Middle Name": profileData["Middle Name"] || "",
      Company: profileData.Company || "",
      CompanyID: profileData.CompanyID || "",
      Title: profileData.Title || "",
      Location: profileData.Location || "",
      Industry: profileData.Industry || "",
      "Connection Degree": profileData["Connection Degree"] || "",
      "Profile URL": profileData["Profile URL"] || "",
      PublicProfile: profileData.PublicProfile || "",
      Degree: profileData.Degree || "",
      Picture: profileData.Picture || profileData.Thumbnail || "",
      Connections: profileData.Connections || "",
      Summary: profileData.Summary || "",
      SalesProfile: profileData.SalesProfile || "",
      RecruiterProfile: profileData.RecruiterProfile || "",
      rawData: payload,
      event_key: eventKey, // Idempotency key
    };

    // PHASE 1: Write to scans collection (legacy, system-of-record)
    // This MUST succeed for webhook to return success
    let scan;
    try {
      scan = await Scan.findOneAndUpdate(
        { id: scanDataToSave.id },
        scanDataToSave,
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      logger.info("Scan data processed in MongoDB", {
        id: scan._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        isNew: !scan.__v || scan.__v === 0,
        event_key: eventKey,
      });
    } catch (dbError) {
      // Legacy write failed - return error (webhook will retry)
      const errorResponse = handleDatabaseError(dbError, 'scan', profileData.id, config.isProduction);
      return res.status(500).json(errorResponse);
    }

    // PHASE 2: Dual-write to people collection (new system)
    // Failures here are logged but don't fail the webhook
    let peopleUpsertSuccess = false;

    try {
      await upsertFromObservation(scan, 'scan');
      peopleUpsertSuccess = true;

      logger.info("Person upserted from scan", {
        scan_id: scan._id,
        event_key: eventKey,
      });
    } catch (peopleError) {
      // Log failure but DON'T fail the webhook
      logger.error("Failed to upsert person from scan", {
        scan_id: scan._id,
        event_key: eventKey,
        error: peopleError.message,
        stack: peopleError.stack,
      });

      // Write to dead_letters for replay
      try {
        const identityHints = resolvePersonIdentity(payload);
        await DeadLetter.createFromFailure(
          scan._id,
          'scan',
          peopleError,
          identityHints,
          payload
        );

        logger.info("Logged failed person upsert to dead_letters", {
          scan_id: scan._id,
          event_key: eventKey,
        });
      } catch (deadLetterError) {
        // If dead_letter fails, just log - don't block webhook
        logger.error("Failed to log to dead_letters", {
          scan_id: scan._id,
          error: deadLetterError.message,
        });
      }
    }

    // Always return success if legacy write succeeded
    const response = createSuccessResponse('scan', scan, profileData);
    response.people_upsert = peopleUpsertSuccess;

    res.status(200).json(response);
  } catch (error) {
    logger.error("Error processing scan data:", {
      error: error.message,
      stack: error.stack,
    });

    const errorResponse = {
      error: "Failed to process scan data",
      message: error.message
    };

    // Don't expose stack traces in production
    if (!config.isProduction && error.stack) {
      errorResponse.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
};

module.exports = { handleScan };