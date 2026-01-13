const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const database = require('../src/utils/database');
const Person = require('../src/models/person');

async function findPerson() {
  await database.connect();

  // Try to find one of the CSV people by various methods
  const username = 'mahesh-chandra-wipro';
  const salesNavId = 'ACoAAAOp_GgBB5xIe1UsUcokRenyVryVDfOYAfI';
  const profileUrl = 'www.linkedin.com/in/mahesh-chandra-wipro';

  console.log('\nSearching for: mahesh-chandra-wipro');
  console.log('=========================================\n');

  const byUsername = await Person.findOne({ 'aliases.value': username });
  console.log('By username:', byUsername ? 'FOUND' : 'NOT FOUND');

  const bySalesNav = await Person.findOne({ 'aliases.value': salesNavId });
  console.log('By Sales Nav ID:', bySalesNav ? 'FOUND' : 'NOT FOUND');

  const byProfileUrl = await Person.findOne({ 'aliases.value': profileUrl });
  console.log('By profile URL:', byProfileUrl ? 'FOUND' : 'NOT FOUND');

  // Check if any person has a similar username
  const similar = await Person.findOne({ 'aliases.value': { $regex: 'mahesh', $options: 'i' } });
  console.log('Similar username:', similar ? 'FOUND' : 'NOT FOUND');

  if (similar) {
    console.log('\nSimilar person found:');
    console.log('  _id:', similar._id);
    console.log('  Name:', similar.snapshot?.fullName);
    console.log('  Aliases:', similar.aliases.map(a => `${a.type}:${a.value}`).join(', '));
  }

  console.log('\n=========================================\n');

  await database.disconnect();
}

findPerson().catch(console.error);
