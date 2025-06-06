const express = require('express');
const logger = require('../utils/logger');
const { handleVisit } = require('../controllers/visitController');
const { handleScan } = require('../controllers/scanController');

const router = express.Router();

// Simple test route
router.get('/test', (req, res) => {
  res.json({ message: 'API routes working' });
});

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

module.exports = router;