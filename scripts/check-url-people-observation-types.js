#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');

async function checkObservationTypes() {
  await mongoose.connect(process.env.MONGODB_URI);

  const urlPeople = await Person.find({
    _id: /^linkedin\.com\/in\//
  }, {
    'observations.visits': 1,
    'observations.scans': 1
  }).lean();

  console.log(`Total URL-based people: ${urlPeople.length}`);

  const stats = {
    hasVisits: 0,
    hasScans: 0,
    hasBoth: 0,
    hasNeither: 0
  };

  for (const person of urlPeople) {
    const hasVisits = person.observations?.visits?.length > 0;
    const hasScans = person.observations?.scans?.length > 0;

    if (hasVisits && hasScans) stats.hasBoth++;
    else if (hasVisits) stats.hasVisits++;
    else if (hasScans) stats.hasScans++;
    else stats.hasNeither++;
  }

  console.log(`\nObservation type breakdown:`);
  console.log(`  Has visits only: ${stats.hasVisits}`);
  console.log(`  Has scans only: ${stats.hasScans}`);
  console.log(`  Has both: ${stats.hasBoth}`);
  console.log(`  Has neither: ${stats.hasNeither}`);

  // Check a few visits to see if they have Sales Nav IDs
  console.log(`\n--- Checking sample visits for Sales Nav data ---\n`);

  const peopleWithVisits = urlPeople.filter(p => p.observations?.visits?.length > 0).slice(0, 5);

  for (const person of peopleWithVisits) {
    const visit = await Visit.findById(person.observations.visits[0]).lean();
    console.log(`Person: ${person._id}`);
    console.log(`  Has SalesProfile field: ${!!visit.SalesProfile || !!visit['Sales Profile']}`);
    console.log(`  SalesProfile value: ${visit.SalesProfile || visit['Sales Profile'] || 'none'}`);
    console.log(`  id field: ${visit.id || visit.Id || 'none'}`);
    console.log('');
  }

  await mongoose.disconnect();
}

checkObservationTypes().catch(console.error);
