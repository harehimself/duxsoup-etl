const logger = require('../utils/logger');

const handleVisit = async (req, res) => {
  try {
    const payload = req.body;
    
    logger.info('Processing visit data', { 
      id: payload.id,
      profile: payload.Profile 
    });
    
    // Validate required fields
    const requiredFields = ['id', 'VisitTime', 'Profile', 'Degree', 'First Name'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
      logger.warn('Missing required fields for visit', { 
        id: payload.id,
        missingFields 
      });
      return res.status(400).json({
        error: 'Missing required fields',
        missingFields,
        required: requiredFields
      });
    }
    
    // Simulate data processing without MongoDB
    logger.info('Visit processed successfully', { 
      id: payload.id,
      profile: payload.Profile
    });
    
    res.status(200).json({
      success: true,
      message: 'Visit data processed successfully',
      data: {
        id: payload.id,
        profile: payload.Profile,
        visitTime: payload.VisitTime,
        message: 'Data validated and logged (MongoDB not connected)'
      }
    });
    
  } catch (error) {
    logger.error('Error processing visit data:', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to process visit data',
      message: error.message
    });
  }
};

module.exports = { handleVisit };