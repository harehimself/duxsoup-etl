const logger = require('../utils/logger');

const handleScan = async (req, res) => {
  try {
    const payload = req.body;
    
    logger.info('Processing scan data', { 
      id: payload.id,
      profile: payload.Profile 
    });
    
    // Validate required fields
    const requiredFields = ['id', 'ScanTime', 'Profile', 'First Name', 'Last Name'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
      logger.warn('Missing required fields for scan', { 
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
    logger.info('Scan processed successfully', { 
      id: payload.id,
      profile: payload.Profile
    });
    
    res.status(200).json({
      success: true,
      message: 'Scan data processed successfully',
      data: {
        id: payload.id,
        profile: payload.Profile,
        scanTime: payload.ScanTime,
        message: 'Data validated and logged (MongoDB not connected)'
      }
    });
    
  } catch (error) {
    logger.error('Error processing scan data:', {
      error: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      error: 'Failed to process scan data',
      message: error.message
    });
  }
};

module.exports = { handleScan };