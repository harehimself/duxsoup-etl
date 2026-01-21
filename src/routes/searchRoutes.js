const express = require('express');
const { searchPeopleHandler } = require('../controllers/searchController');

const router = express.Router();

/**
 * Search Routes
 *
 * Full-text search endpoints
 */

// Search people
router.get('/', searchPeopleHandler);

module.exports = router;
