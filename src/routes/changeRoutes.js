const express = require('express');
const {
  getRecentChangesHandler,
  getPersonChangesHandler,
} = require('../controllers/changeController');

const router = express.Router();

/**
 * Change Routes
 *
 * Endpoints for querying job changes, promotions, and title changes
 */

// Get recent changes
router.get('/', getRecentChangesHandler);

// Get changes for a specific person
router.get('/person/:id', getPersonChangesHandler);

module.exports = router;
