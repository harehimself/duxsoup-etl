#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const { parseLocation } = require('../src/utils/location-parser');

async function analyzeFailures() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const testLocations = [
    'Dallas-Fort Worth Metroplex',
    'New York City Metropolitan Area',
    'Greater Boston',
    'Greater Philadelphia',
    'Charlotte Metro',
    'San Francisco Bay Area',
    'New York, New York, United States'
  ];
  
  console.log('Testing location parser:\n');
  testLocations.forEach(loc => {
    const result = parseLocation(loc);
    console.log(`Location: "${loc}"`);
    console.log(`  City: ${result.city}`);
    console.log(`  State: ${result.state} (${result.stateCode})`);
    console.log(`  Country: ${result.country} (${result.countryCode})`);
    console.log(`  Type: ${result.locationType}`);
    console.log('');
  });
  
  await mongoose.disconnect();
}

analyzeFailures().catch(console.error);
