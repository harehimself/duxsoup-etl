const express = require('express');
const {
  queryPeopleHandler,
  queryCompaniesHandler,
  getQueryHelp,
} = require('../controllers/queryController');

const router = express.Router();

/**
 * Query Routes
 *
 * Endpoints for querying people and companies with flexible filters
 */

// Query people
router.post('/people', queryPeopleHandler);

// Query companies
router.post('/companies', queryCompaniesHandler);

// Get help/documentation
router.get('/help', getQueryHelp);

module.exports = router;
