const personReadService = require('../services/personReadService');
const logger = require('../utils/logger');
const { getConfig } = require('../utils/env');

/**
 * Person Read Controller
 *
 * Endpoints for reading person data with hybrid cutover support.
 * All reads go through personReadService which implements fallback logic.
 */

/**
 * GET /api/people/:id
 * Get person by canonical ID
 */
async function getPersonById(req, res) {
  const { id } = req.params;
  const config = getConfig();

  logger.info('Get person by ID', {
    person_id: id,
    read_source: config.readSource,
  });

  try {
    const result = await personReadService.findPersonById(id);

    if (!result) {
      return res.status(404).json({
        error: 'Person not found',
        person_id: id,
        read_source: config.readSource,
      });
    }

    res.json({
      success: true,
      source: result.source,
      read_source: config.readSource,
      person: result.person,
    });
  } catch (error) {
    logger.error('Error getting person by ID', {
      person_id: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to get person',
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
  const config = getConfig();

  logger.info('Get person by alias', {
    alias_value: value,
    read_source: config.readSource,
  });

  try {
    const result = await personReadService.findPersonByAlias(value);

    if (!result) {
      return res.status(404).json({
        error: 'Person not found',
        alias_value: value,
        read_source: config.readSource,
      });
    }

    res.json({
      success: true,
      source: result.source,
      read_source: config.readSource,
      person: result.person,
    });
  } catch (error) {
    logger.error('Error getting person by alias', {
      alias_value: value,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to get person',
      message: error.message,
    });
  }
}

/**
 * GET /api/people/metrics
 * Get read metrics (for monitoring cutover)
 */
async function getReadMetrics(req, res) {
  try {
    const metrics = personReadService.getMetrics();
    const config = getConfig();

    res.json({
      read_source: config.readSource,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting read metrics', {
      error: error.message,
    });

    res.status(500).json({
      error: 'Failed to get metrics',
      message: error.message,
    });
  }
}

module.exports = {
  getPersonById,
  getPersonByAlias,
  getReadMetrics,
};
