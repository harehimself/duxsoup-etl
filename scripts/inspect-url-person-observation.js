#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

async function inspect() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Get a URL-based person
  const person = await Person.findOne({
    _id: /^linkedin\.com\/in\//
  }).lean();

  console.log('Person ID:', person._id);
  console.log('Name:', person.snapshot?.name);
  console.log('Aliases:', JSON.stringify(person.aliases, null, 2));
  console.log('\n--- First Visit ---');

  if (person.observations?.visits?.[0]) {
    const visit = await Visit.findById(person.observations.visits[0]).lean();
    console.log(JSON.stringify(visit, null, 2));
  }

  if (person.observations?.scans?.[0]) {
    const scan = await Scan.findById(person.observations.scans[0]).lean();
    console.log('\n--- First Scan ---');
    console.log(JSON.stringify(scan, null, 2));
  }

  await mongoose.disconnect();
}

inspect().catch(console.error);
