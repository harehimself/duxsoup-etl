const express = require('express');
const logger = require('../utils/logger');
const { handleVisit } = require('../controllers/visitController');
const { handleScan } = require('../controllers/scanController');
const {
  getIngestionHealth,
  getParityHealth,
  getMetrics,
  getCoverageBreakdown,
  getCanonicalCoverage,
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

// Version endpoint to verify deployed code
router.get('/version', (req, res) => {
  const { exec } = require('child_process');
  exec('git rev-parse --short HEAD', (error, stdout, stderr) => {
    if (error) {
      return res.json({
        version: 'unknown',
        error: error.message,
        regex_test: {
          ACwAAA: /A[Cc][owA][AAA][A-Za-z0-9_-]+/.test('ACwAAA-test'),
          ACoAAA: /A[Cc][owA][AAA][A-Za-z0-9_-]+/.test('ACoAAA-test')
        }
      });
    }
    res.json({
      commit: stdout.trim(),
      regex_test: {
        ACwAAA: /A[Cc][owA][AAA][A-Za-z0-9_-]+/.test('ACwAAA-test'),
        ACoAAA: /A[Cc][owA][AAA][A-Za-z0-9_-]+/.test('ACoAAA-test')
      }
    });
  });
});

// Health endpoints for ops monitoring
router.get('/health/ingestion', getIngestionHealth);
router.get('/health/parity', getParityHealth);
router.get('/health/metrics', getMetrics);
router.get('/health/coverage-breakdown', getCoverageBreakdown);
router.get('/health/canonical-coverage', getCanonicalCoverage);

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
