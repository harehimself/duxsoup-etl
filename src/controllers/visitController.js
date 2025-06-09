const logger = require('../utils/logger');
const Visit = require('../models/visit');

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
    
    // Create visit document
    const visitData = {
      duxsoupId: payload.id,
      visitTime: new Date(payload.VisitTime),
      profile: payload.Profile,
      firstName: payload['First Name'],
      lastName: payload['Last Name'] || '',
      degree: payload.Degree,
      company: payload.Company || '',
      title: payload.Title || '',
      location: payload.Location || '',
      industry: payload.Industry || '',
      connectionDegree: payload['Connection Degree'] || '',
      profileUrl: payload['Profile URL'] || '',
      rawData: payload
    };
    
    try {
      // Try to create new visit
      const visit = new Visit(visitData);
      await visit.save();
      
      logger.info('Visit saved to MongoDB', { 
        id: visit._id,
        duxsoupId: payload.id,
        profile: payload.Profile
      });
      
      res.status(201).json({
        success: true,
        message: 'Visit data saved successfully',
        data: {
          id: visit._id,
          duxsoupId: payload.id,
          profile: payload.Profile,
          visitTime: payload.VisitTime,
          firstName: payload['First Name'],
          status: 'saved to database'
        }
      });
      
    } catch (dbError) {
      if (dbError.code === 11000) {
        // Duplicate key error - visit already exists
        logger.warn('Duplicate visit detected', { 
          duxsoupId: payload.id 
        });
        
        res.status(200).json({
          success: true,
          message: 'Visit already exists',
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