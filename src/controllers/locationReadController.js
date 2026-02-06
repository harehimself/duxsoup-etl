const locationReadService = require("../services/locationReadService");
const logger = require("../utils/logger");

async function getLocationById(req, res) {
  const { id } = req.params;

  logger.info("Get location by ID", { location_id: id });

  try {
    const result = await locationReadService.findLocationById(id);

    if (!result) {
      return res.status(404).json({
        error: "Location not found",
        location_id: id,
      });
    }

    res.json({
      success: true,
      location: result.location,
    });
  } catch (error) {
    logger.error("Error getting location by ID", {
      location_id: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to get location",
      message: error.message,
    });
  }
}

async function getLocationByAlias(req, res) {
  const { value } = req.params;

  logger.info("Get location by alias", { alias_value: value });

  try {
    const result = await locationReadService.findLocationByAlias(value);

    if (!result) {
      return res.status(404).json({
        error: "Location not found",
        alias_value: value,
      });
    }

    res.json({
      success: true,
      location: result.location,
    });
  } catch (error) {
    logger.error("Error getting location by alias", {
      alias_value: value,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: "Failed to get location",
      message: error.message,
    });
  }
}

module.exports = {
  getLocationById,
  getLocationByAlias,
};
