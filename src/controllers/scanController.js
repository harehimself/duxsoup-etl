const logger = require('../utils/logger');
const Scan = require('../models/scan');

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
    
    // Create scan document
    const scanData = {
      duxsoupId: payload.id,
      scanTime: new Date(payload.ScanTime),
      profile: payload.Profile,
      firstName: payload['First Name'],
      lastName: payload['Last Name'],
      company: payload.Company || '',
      title: payload.Title || '',
      location: payload.Location || '',
      industry: payload.Industry || '',
      connectionDegree: payload['Connection Degree'] || '',
      profileUrl: payload['Profile URL'] || '',
      rawData: payload
    };
    
    try {
      // Try to create new scan
      const scan = new Scan(scanData);
      await scan.save();
      
      logger.info('Scan saved to MongoDB', { 
        id: scan._id,
        duxsoupId: payload.id,
        profile: payload.Profile
      });
      
      res.status(201).json({
        success: true,
        message: 'Scan data saved successfully',
        data: {
          id: scan._id,
          duxsoupId: payload.id,
          profile: payload.Profile,
          scanTime: payload.ScanTime,
          firstName: payload['First Name'],
          lastName: payload['Last Name'],
          status: 'saved to database'
        }
      });
      
    } catch (dbError) {
      if (dbError.code === 11000) {
        // Duplicate key error - scan already exists
        logger.warn('Duplicate scan detected', { 
          duxsoupId: payload.id 
        });
        
        res.status(200).json({
          success: true,
          message: 'Scan already exists',
          data: {
            duxsoupId: payload.id,
            profile: payload.Profile,
            status: 'duplicate - already in database'
          }
        });
      } else {
        throw dbError;
      }
    }
    
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