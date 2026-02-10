const personReadService = require("../services/personReadService");
const logger = require("../utils/logger");
const { MAX_BATCH_SIZE } = require("../constants/limits");

/**
 * Person Read Controller
 *
 * Endpoints for reading person data from the people collection.
 */

/**
 * GET /api/people/:id
 * Get person by canonical ID
 */
async function getPersonById(req, res) {
  const { id } = req.params;

  logger.info("Get person by ID", { person_id: id });

  try {
    const result = await personReadService.findPersonById(id);

    if (!result) {
      return res.status(404).json({
        error: "Person not found",
        person_id: id,
      });
    }

    res.json({
      success: true,
      person: result.person,
    });
  } catch (error) {
    logger.error("Error getting person by ID", {
      person_id: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to get person",
      message: error.message,
    });
  }
}

/**
 * GET /api/people/by-alias/:value
 * Get person by alias (Sales Nav ID, numeric ID, or public URL)
 */
async function getPersonByAlias(req, res) {
  const { value } = req.params;

  logger.info("Get person by alias", { alias_value: value });

  try {
    const result = await personReadService.findPersonByAlias(value);

    if (!result) {
      return res.status(404).json({
        error: "Person not found",
        alias_value: value,
      });
    }

    res.json({
      success: true,
      person: result.person,
    });
  } catch (error) {
    logger.error("Error getting person by alias", {
      alias_value: value,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to get person",
      message: error.message,
    });
  }
}

/**
 * POST /api/people/by-aliases
 * Bulk lookup people by alias values
 */
async function getPersonsByAliases(req, res) {
  const { values } = req.body;

  if (!values) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "Request body must include a 'values' array",
    });
  }

  if (!Array.isArray(values)) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "'values' must be an array",
    });
  }

  if (values.length === 0) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: "'values' array must not be empty",
    });
  }

  if (values.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      success: false,
      error: "VALIDATION_ERROR",
      message: `'values' array exceeds maximum size of ${MAX_BATCH_SIZE}`,
    });
  }

  const uniqueValues = [...new Set(values)];

  logger.info("Bulk alias lookup", { count: uniqueValues.length });

  try {
    const resultMap = await personReadService.findPeopleByAliases(uniqueValues);

    const results = uniqueValues.map((value) => ({
      value,
      found: resultMap.has(value),
      person: resultMap.get(value) || null,
    }));

    const found = results.filter((r) => r.found).length;

    res.json({
      success: true,
      total: uniqueValues.length,
      found,
      notFound: uniqueValues.length - found,
      results,
    });
  } catch (error) {
    logger.error("Error in bulk alias lookup", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: "INTERNAL_ERROR",
      message: "Failed to perform bulk alias lookup",
    });
  }
}

module.exports = {
  getPersonById,
  getPersonByAlias,
  getPersonsByAliases,
};
