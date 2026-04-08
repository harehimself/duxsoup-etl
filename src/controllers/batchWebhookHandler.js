const logger = require("../utils/logger");
const { MAX_BATCH_SIZE } = require("../constants/limits");
const { processObservationPayload } = require("./observationHandler");
const { getVisitConfig } = require("./visitController");
const { getScanConfig } = require("./scanController");

const CONFIG_BY_TYPE = {
  visit: getVisitConfig,
  scan: getScanConfig,
};

/**
 * Batch webhook handler — processes an array of webhook payloads
 * in a single HTTP request.
 *
 * Request body: { payloads: [ {type, ...}, {type, ...}, ... ] }
 *
 * Each payload is processed sequentially using the same logic as
 * POST /api/webhook. Per-item errors are isolated — one bad payload
 * does not fail the batch.
 */
async function handleBatchWebhook(req, res) {
  const { payloads } = req.body;

  // Validate payloads field exists and is a non-empty array within limits
  if (!payloads) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Request body must contain a 'payloads' array",
    });
  }

  if (!Array.isArray(payloads)) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "'payloads' must be an array",
    });
  }

  if (payloads.length === 0) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "'payloads' array must not be empty",
    });
  }

  if (payloads.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: `Batch size ${payloads.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
    });
  }

  logger.info("Batch webhook received", { count: payloads.length });

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];

    // Resolve config by type
    if (!payload || !payload.type) {
      results.push({
        index: i,
        success: false,
        error: "Missing type field",
      });
      failed++;
      continue;
    }

    const configFactory = CONFIG_BY_TYPE[payload.type];
    if (!configFactory) {
      results.push({
        index: i,
        success: false,
        error: `Invalid type '${payload.type}'. Must be 'visit' or 'scan'`,
      });
      failed++;
      continue;
    }

    try {
      const config = configFactory();
      const result = await processObservationPayload(config, payload);

      if (result.success) {
        results.push({
          index: i,
          success: true,
          type: payload.type,
          id: result.data?.visitId || result.data?.scanId || undefined,
          warnings: result.data?.warnings || [],
        });
        succeeded++;
      } else {
        results.push({
          index: i,
          success: false,
          error: result.error || result.data?.error || "Processing failed",
        });
        failed++;
      }
    } catch (error) {
      logger.error("Unexpected error processing batch item", {
        index: i,
        type: payload.type,
        error: error.message,
      });
      results.push({
        index: i,
        success: false,
        error: error.message,
      });
      failed++;
    }
  }

  logger.info("Batch webhook completed", {
    total: payloads.length,
    succeeded,
    failed,
  });

  res.status(200).json({
    success: true,
    message: `Batch processed: ${succeeded} succeeded, ${failed} failed`,
    total: payloads.length,
    succeeded,
    failed,
    results,
  });
}

module.exports = { handleBatchWebhook };
