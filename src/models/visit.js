const mongoose = require('mongoose');
const logger = require('../utils/logger');

const visitSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  VisitTime: { type: Date, required: true },
  Profile: { type: String, required: true },
  Degree: { type: String, required: true },
  'First Name': { type: String, required: true },
  'Last Name': String,
  
  // Normalized arrays
  positions: [{
    company: String,
    title: String,
    startDate: String,
    endDate: String,
    duration: String,
    location: String,
    description: String,
    // Additional position fields can be added here
  }],
  
  schools: [{
    school: String,
    degree: String,
    field: String,
    startYear: String,
    endYear: String,
    activities: String,
    // Additional school fields can be added here
  }],
  
  skills: [String] // Array of skill strings
}, { 
  strict: false, // Allow flexible fields
  timestamps: true 
});

// Pre-save hook to normalize data
visitSchema.pre('save', function(next) {
  try {
    logger.debug('Processing Visit data normalization', { id: this.id });
    
    // Extract positions (up to 36 data points)
    const positions = [];
    const positionFields = {};
    
    // Group position fields by index
    Object.keys(this.toObject()).forEach(key => {
      const positionMatch = key.match(/^Position-(\d+)-(.+)$/);
      if (positionMatch) {
        const index = parseInt(positionMatch[1]);
        const field = positionMatch[2];
        
        if (!positionFields[index]) {
          positionFields[index] = {};
        }
        
        positionFields[index][field.toLowerCase().replace(/\s+/g, '')] = this[key];
        this[key] = undefined; // Remove raw field
      }
    });
    
    // Convert to positions array
    Object.keys(positionFields).forEach(index => {
      const pos = positionFields[index];
      positions.push({
        company: pos.company,
        title: pos.title,
        startDate: pos.startdate || pos.start,
        endDate: pos.enddate || pos.end,
        duration: pos.duration,
        location: pos.location,
        description: pos.description
      });
    });
    
    if (positions.length > 0) {
      this.positions = positions;
    }
    
    // Extract schools (up to 20 data points)
    const schools = [];
    const schoolFields = {};
    
    Object.keys(this.toObject()).forEach(key => {
      const schoolMatch = key.match(/^School-(\d+)-(.+)$/);
      if (schoolMatch) {
        const index = parseInt(schoolMatch[1]);
        const field = schoolMatch[2];
        
        if (!schoolFields[index]) {
          schoolFields[index] = {};
        }
        
        schoolFields[index][field.toLowerCase().replace(/\s+/g, '')] = this[key];
        this[key] = undefined; // Remove raw field
      }
    });
    
    // Convert to schools array
    Object.keys(schoolFields).forEach(index => {
      const school = schoolFields[index];
      schools.push({
        school: school.school || school.name,
        degree: school.degree,
        field: school.field || school.fieldofstudy,
        startYear: school.startyear || school.start,
        endYear: school.endyear || school.end,
        activities: school.activities
      });
    });
    
    if (schools.length > 0) {
      this.schools = schools;
    }
    
    // Extract skills (up to 20 data points)
    const skills = [];
    
    Object.keys(this.toObject()).forEach(key => {
      const skillMatch = key.match(/^Skill-(\d+)$/);
      if (skillMatch && this[key]) {
        skills.push(this[key]);
        this[key] = undefined; // Remove raw field
      }
    });
    
    if (skills.length > 0) {
      this.skills = skills;
    }
    
    logger.debug('Visit normalization complete', { 
      id: this.id, 
      positionsCount: positions.length,
      schoolsCount: schools.length,
      skillsCount: skills.length
    });
    
    next();
  } catch (error) {
    logger.error('Error in Visit pre-save hook:', error);
    next(error);
  }
});

module.exports = mongoose.model('Visit', visitSchema);