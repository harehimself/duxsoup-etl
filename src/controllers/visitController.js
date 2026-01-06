const logger = require("../utils/logger");
const Visit = require("../models/visit");
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

const handleVisit = async (req, res) => {
  const payload = req.body;
  const config = getConfig();

  try {

    // Validate webhook payload structure
    const payloadValidation = validateWebhookPayload(payload, 'visit');
    if (!payloadValidation.isValid) {
      return res.status(400).json(createErrorResponse(payloadValidation.error));
    }

    const profileData = payloadValidation.profileData;

    logger.info("Processing visit data", {
      id: profileData.id,
      profile: profileData.Profile,
    });

    // Validate required fields
    const requiredFields = ["VisitTime", "Profile", "Degree", "First Name"];
    const fieldsValidation = validateRequiredFields(profileData, requiredFields, 'visit');

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

    const visitDataToSave = {
      id: profileData.id,
      VisitTime: new Date(profileData.VisitTime),
      Profile: profileData.Profile,
      "First Name": profileData["First Name"],
      "Last Name": profileData["Last Name"] || "",
      Degree: profileData.Degree,
      SalesProfile: profileData.SalesProfile || "",
      RecruiterProfile: profileData.RecruiterProfile || "",
      Picture: profileData.Picture || "",
      "Middle Name": profileData["Middle Name"] || "",
      Connections: profileData.Connections || "",
      Summary: profileData.Summary || "",
      Title: profileData.Title || "",
      From: profileData.From || "",
      Company: profileData.Company || "",
      CompanyProfile: profileData.CompanyProfile || "",
      CompanyWebsite: profileData.CompanyWebsite || "",
      PersonalWebsite: profileData.PersonalWebsite || "",
      Email: profileData.Email || "",
      Phone: profileData.Phone || "",
      IM: profileData.IM || "",
      Twitter: profileData.Twitter || "",
      Location: profileData.Location || "",
      Industry: profileData.Industry || "",
      "My Tags": profileData["My Tags"] || [],
      extended: profileData.extended,
      "My Notes": profileData["My Notes"] || "",
      // Metadata fields from top-level payload
      userid: payload.userid || "",
      time: payload.time ? new Date(payload.time) : null,
      type: payload.type || "",
      event: payload.event || "",
      messagecontext: payload.messagecontext || "",
      rawData: payload,
      event_key: eventKey, // Idempotency key
    };

    // PHASE 1: Write to visits collection (legacy, system-of-record)
    // This MUST succeed for webhook to return success
    let visit;
    let isDuplicate = false;

    try {
      // Use event_key for idempotency
      visit = await Visit.findOneAndUpdate(
        { event_key: eventKey },
        { $setOnInsert: visitDataToSave },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

      // First insert - not a duplicate
      isDuplicate = false;

      logger.info("Visit data processed in MongoDB", {
        id: visit._id,
        duxsoupId: profileData.id,
        profile: profileData.Profile,
        isDuplicate,
        event_key: eventKey,
      });
    } catch (dbError) {
      // E11000 duplicate key error - webhook retried, find existing visit
      if (dbError.code === 11000 && dbError.keyPattern?.event_key) {
        logger.info("Duplicate event_key detected, returning existing visit", {
          event_key: eventKey,
        });

        visit = await Visit.findOne({ event_key: eventKey });
        isDuplicate = true;

        if (!visit) {
          // Race condition - retry once
          visit = await Visit.findOne({ event_key: eventKey });
        }

        if (!visit) {
          // Should never happen, but log and fail
          logger.error("E11000 but cannot find visit by event_key", { event_key: eventKey });
          return res.status(500).json({ error: "Duplicate detection failed" });
        }
      } else {
        // Other DB error - fail the webhook
        const errorResponse = handleDatabaseError(dbError, 'visit', profileData.id, config.isProduction);
        return res.status(500).json(errorResponse);
      }
    }

    // PHASE 2: Dual-write to people collection (new system)
    // Failures here are logged but don't fail the webhook
    // Skip if this is a duplicate (already processed)
    let peopleUpsertSuccess = false;

    if (isDuplicate) {
      logger.info("Skipping person upsert for duplicate event", {
        visit_id: visit._id,
        event_key: eventKey,
      });
      peopleUpsertSuccess = true; // Already processed before
    } else {
      try {
        await upsertFromObservation(visit, 'visit');
        peopleUpsertSuccess = true;

        logger.info("Person upserted from visit", {
          visit_id: visit._id,
          event_key: eventKey,
        });
      } catch (peopleError) {
      // Log failure but DON'T fail the webhook
      logger.error("Failed to upsert person from visit", {
        visit_id: visit._id,
        event_key: eventKey,
        error: peopleError.message,
        stack: peopleError.stack,
      });

      // Write to dead_letters for replay
      try {
        const identityHints = resolvePersonIdentity(payload);
        await DeadLetter.createFromFailure(
          visit._id,
          'visit',
          peopleError,
          identityHints,
          payload
        );

        logger.info("Logged failed person upsert to dead_letters", {
          visit_id: visit._id,
          event_key: eventKey,
        });
      } catch (deadLetterError) {
        // If dead_letter fails, just log - don't block webhook
        logger.error("Failed to log to dead_letters", {
          visit_id: visit._id,
          error: deadLetterError.message,
        });
      }
      }
    }

    // Always return success if legacy write succeeded
    const response = createSuccessResponse('visit', visit, profileData);
    response.people_upsert = peopleUpsertSuccess;
    response.duplicate = isDuplicate;

    res.status(200).json(response);
  } catch (error) {
    logger.error("Error processing visit data:", {
      error: error.message,
      stack: error.stack,
    });

    const errorResponse = {
      error: "Failed to process visit data",
      message: error.message
    };

    // Don't expose stack traces in production
    if (!config.isProduction && error.stack) {
      errorResponse.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
};

module.exports = { handleVisit };