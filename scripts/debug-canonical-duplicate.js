#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');

async function debug() {
  await mongoose.connect(process.env.MONGODB_URI);

  const urlId = 'linkedin.com/in/aimee-pasia-0713083';
  const targetId = 'ACoAAACUSlUBiMbR150okSlZ8hxJFi14wMFri0U';

  // Check if URL person exists
  const urlPerson = await Person.findById(urlId).lean();
  console.log('URL person exists?', !!urlPerson);
  if (urlPerson) {
    console.log('  canonical_id:', urlPerson.canonical_id);
    console.log('  name:', urlPerson.snapshot?.name);
  }

  // Check if target person exists
  const targetPerson = await Person.findById(targetId).lean();
  console.log('\nTarget person exists?', !!targetPerson);
  if (targetPerson) {
    console.log('  canonical_id:', targetPerson.canonical_id);
    console.log('  name:', targetPerson.snapshot?.name);
  }

  // Find all people with this canonical_id
  if (urlPerson) {
    const peopleWithSameCanonical = await Person.find({
      canonical_id: urlPerson.canonical_id
    }).lean();

    console.log(`\nPeople with canonical_id ${urlPerson.canonical_id}:`);
    peopleWithSameCanonical.forEach(p => {
      console.log(`  - _id: ${p._id}`);
      console.log(`    name: ${p.snapshot?.name}`);
    });
  }

  await mongoose.disconnect();
}

debug().catch(console.error);
