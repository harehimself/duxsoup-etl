const personReadService = require("../services/personReadService");
const logger = require("../utils/logger");

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

module.exports = {
  getPersonById,
  getPersonByAlias,
};
