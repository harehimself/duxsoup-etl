const express = require('express');
const logger = require('../utils/logger');
const { handleVisit } = require('../controllers/visitController');
const { handleScan } = require('../controllers/scanController');
const {
  getIngestionHealth,
  getParityHealth,
  getMetrics,
  getCoverageBreakdown,
} = require('../controllers/healthController');
const {
  getPersonById,
  getPersonByAlias,
  getReadMetrics,
} = require('../controllers/personReadController');
const adminRoutes = require('./adminRoutes');

const router = express.Router();

// Simple test route
router.get('/test', (req, res) => {
  res.json({ message: 'API routes working' });
});

// Health endpoints for ops monitoring
router.get('/health/ingestion', getIngestionHealth);
router.get('/health/parity', getParityHealth);
router.get('/health/metrics', getMetrics);
router.get('/health/coverage-breakdown', getCoverageBreakdown);

// Person read endpoints (hybrid cutover)
router.get('/people/metrics', getReadMetrics);
router.get('/people/:id', getPersonById);
router.get('/people/by-alias/:value', getPersonByAlias);

// Main webhook endpoint
router.post('/webhook', (req, res) => {
  const payload = req.body;
  
  logger.info('Webhook received', { 
    type: payload.type,
    id: payload.id
  });
  
  if (!payload.type) {
    return res.status(400).json({
      error: 'Missing type field'
    });
  }
  
  if (payload.type === 'visit') {
    return handleVisit(req, res);
  } else if (payload.type === 'scan') {
    return handleScan(req, res);
  } else {
    return res.status(400).json({
      error: 'Invalid payload type',
      message: 'Type must be either "visit" or "scan"'
    });
  }
});

// Admin endpoints (one-time migrations, etc.)
router.use('/admin', adminRoutes);

module.exports = router;