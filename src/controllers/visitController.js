const logger = require('../utils/logger');
const Visit = require('../models/Visit');

// Helper function to normalize position data
const normalizePositions = (payload) => {
  const positions = [];
  let i = 0;
  
  while (payload[`Position-${i}-Company`]) {
    positions.push({
      company: payload[`Position-${i}-Company`],
      title: payload[`Position-${i}-Title`],
      startDate: payload[`Position-${i}-StartDate`],
      endDate: payload[`Position-${i}-EndDate`],
      duration: payload[`Position-${i}-Duration`],
      location: payload[`Position-${i}-Location`]
    });
    i++;
  }
  
  return positions;
};

// Helper function to normalize education data
const normalizeEducation = (payload) => {
  const education = [];
  let i = 0;
  
  while (payload[`School-${i}-School`]) {
    education.push({
      school: payload[`School-${i}-School`],
      degree: payload[`School-${i}-Degree`],
      startYear: payload[`School-${i}-StartYear`],
      endYear: payload[`School-${i}-EndYear`]
    });
    i++;
  }
  
  return education;
};

// Helper function to normalize skills
const normalizeSkills = (payload) => {
  const skills = [];
  let i = 0;
  
  while (payload[`Skill-${i}`]) {
    skills.push(payload[`Skill-${i}`]);
    i++;
  }
  
  return skills;
};

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
    
    // Normalize and structure the data
    const visitData = {
      id: payload.id,
      visitTime: new Date(payload.VisitTime),
      profile: payload.Profile,
      degree: payload.Degree,
      firstName: payload['First Name'],
      lastName: payload['Last Name'],
      headline: payload.Headline,
      location: payload.Location,
      connections: payload.Connections,
      industry: payload.Industry,
      summary: payload.Summary,
      positions: normalizePositions(payload),
      education: normalizeEducation(payload),
      skills: normalizeSkills(payload)
    };
    
    // Try to save to MongoDB
    try {
      // Use upsert to handle duplicates
      const visit = await Visit.findOneAndUpdate(
        { id: payload.id },
        visitData,
        { 
          upsert: true, 
          new: true,
          runValidators: true 
        }
      );
      
      logger.info('Visit saved to MongoDB', { 
        id: visit.id,
        profile: visit.profile,
        mongoId: visit._id,
        positions: visit.positions.length,
        education: visit.education.length,
        skills: visit.skills.length
      });
      
      res.status(200).json({
        success: true,
        message: 'Visit data saved to database',
        data: {
          id: visit.id,
          profile: visit.profile,
          visitTime: visit.visitTime,
          positions: visit.positions.length,
          education: visit.education.length,
          skills: visit.skills.length,
          mongoId: visit._id
        }
      });
      
    } catch (dbError) {
      // If MongoDB fails, log but don't crash
      logger.warn('Failed to save to MongoDB, continuing without storage', {
        id: payload.id,
        error: dbError.message
      });
      
      // Still return success but indicate no storage
      res.status(200).json({
        success: true,
        message: 'Visit data processed (MongoDB unavailable)',
        data: {
          id: payload.id,
          profile: payload.Profile,
          visitTime: payload.VisitTime,
          warning: 'Data not stored permanently'
        }
      });
    }
    
  } catch (error) {
    logger.error('Error processing visit data:', {
      error: error.message,
      stack: error.stack,
      payload: payload
    });
    
    res.status(500).json({
      error: 'Failed to process visit data',
      message: error.message
    });
  }
};

module.exports = { handleVisit };