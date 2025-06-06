const logger = require('../utils/logger');
const Scan = require('../models/Scan');

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
    
    // Normalize and structure the data
    const scanData = {
      id: payload.id,
      scanTime: new Date(payload.ScanTime),
      profile: payload.Profile,
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
      const scan = await Scan.findOneAndUpdate(
        { id: payload.id },
        scanData,
        { 
          upsert: true, 
          new: true,
          runValidators: true 
        }
      );
      
      logger.info('Scan saved to MongoDB', { 
        id: scan.id,
        profile: scan.profile,
        mongoId: scan._id,
        positions: scan.positions.length,
        education: scan.education.length,
        skills: scan.skills.length
      });
      
      res.status(200).json({
        success: true,
        message: 'Scan data saved to database',
        data: {
          id: scan.id,
          profile: scan.profile,
          scanTime: scan.scanTime,
          firstName: scan.firstName,
          lastName: scan.lastName,
          positions: scan.positions.length,
          education: scan.education.length,
          skills: scan.skills.length,
          mongoId: scan._id
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
        message: 'Scan data processed (MongoDB unavailable)',
        data: {
          id: payload.id,
          profile: payload.Profile,
          scanTime: payload.ScanTime,
          warning: 'Data not stored permanently'
        }
      });
    }
    
  } catch (error) {
    logger.error('Error processing scan data:', {
      error: error.message,
      stack: error.stack,
      payload: payload
    });
    
    res.status(500).json({
      error: 'Failed to process scan data',
      message: error.message
    });
  }
};

module.exports = { handleScan };