#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Scan = require('../src/models/scan');

async function checkObservation() {
  await mongoose.connect(process.env.MONGODB_URI);
  const scan = await Scan.findById('67c9fa79575df7f4e8bebb59');
  console.log('Location field:', scan?.Location);
  await mongoose.disconnect();
}

checkObservation().catch(console.error);
