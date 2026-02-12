const { getPersonTimeline } = require("../services/timelineService");
const logger = require("../utils/logger");

/**
 * GET /api/people/:id/timeline
 *
 * Returns a chronological feed of all observed events and changes for a person.
 *
 * Query params:
 *   limit  - max results (default 50, max 500)
 *   offset - pagination offset (default 0)
 *   from   - ISO date lower bound
 *   to     - ISO date upper bound
 */
async function getPersonTimeline_handler(req, res, next) {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const { from, to } = req.query;

    // Validate date params if provided
    if (from && isNaN(Date.parse(from))) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "'from' must be a valid ISO date string",
      });
    }
    if (to && isNaN(Date.parse(to))) {
      return res.status(400).json({
        success: false,
        error: "VALIDATION_ERROR",
        message: "'to' must be a valid ISO date string",
      });
    }

    logger.info("Timeline request", { personId: id, limit, offset, from, to });

    const result = await getPersonTimeline(id, { limit, offset, from, to });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND",
        message: `Person ${id} not found`,
      });
    }

    res.json({
      success: true,
      data: {
        personId: id,
        timeline: result.timeline,
        metadata: result.metadata,
      },
      total: result.metadata.totalEvents,
      limit,
      offset,
    });
  } catch (err) {
    logger.error("Error getting person timeline", {
      error: err.message,
      stack: err.stack,
    });
    next(err);
  }
}

module.exports = { getPersonTimeline: getPersonTimeline_handler };
