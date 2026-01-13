#!/usr/bin/env node
/**
 * Compare Visit vs Scan Data Completeness
 * Determines which observation type has richer data
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

async function compareDataSources() {
  console.log('━'.repeat(70));
  console.log('  VISIT vs SCAN DATA COMPLETENESS');
  console.log('━'.repeat(70) + '\n');

  // Sample visits and scans
  const sampleSize = 100;
  const visits = await Visit.find().limit(sampleSize).lean();
  const scans = await Scan.find().limit(sampleSize).lean();

  console.log(`Analyzing ${visits.length} visits and ${scans.length} scans\n`);

  // Define fields to check
  const commonFields = [
    { visit: 'First Name', scan: 'First Name' },
    { visit: 'Last Name', scan: 'Last Name' },
    { visit: 'Title', scan: 'Title' },
    { visit: 'Company', scan: 'Company' },
    { visit: 'Location', scan: 'Location' },
    { visit: 'Industry', scan: 'Industry' },
    { visit: 'Connections', scan: 'Connections' },
    { visit: 'Email', scan: null },
    { visit: 'Phone', scan: null },
    { visit: 'Picture', scan: null },
    { visit: 'Summary', scan: 'Summary' },
    { visit: 'CompanyProfile', scan: 'CompanyID' }
  ];

  console.log('FIELD AVAILABILITY COMPARISON:');
  console.log('─'.repeat(70));
  console.log(`${'Field'.padEnd(25)} ${'Visits'.padStart(12)} ${'Scans'.padStart(12)} ${'Winner'}`);
  console.log('─'.repeat(70));

  for (const fieldPair of commonFields) {
    const visitField = fieldPair.visit;
    const scanField = fieldPair.scan;

    // Count non-empty values in visits
    const visitCount = visits.filter(v => {
      const value = v[visitField];
      return value && value !== '' && value !== 'none';
    }).length;
    const visitPercent = ((visitCount / visits.length) * 100).toFixed(1);

    // Count non-empty values in scans
    let scanCount = 0;
    let scanPercent = '0.0';
    if (scanField) {
      scanCount = scans.filter(s => {
        const value = s[scanField];
        return value && value !== '' && value !== 'none';
      }).length;
      scanPercent = ((scanCount / scans.length) * 100).toFixed(1);
    } else {
      scanPercent = 'N/A';
    }

    const winner = scanPercent === 'N/A'
      ? 'Visit only'
      : parseFloat(visitPercent) > parseFloat(scanPercent)
        ? '🏆 Visit'
        : parseFloat(scanPercent) > parseFloat(visitPercent)
          ? '🏆 Scan'
          : 'Tie';

    console.log(
      `${visitField.padEnd(25)} ${(visitPercent + '%').padStart(12)} ${(scanPercent + (scanPercent !== 'N/A' ? '%' : '')).padStart(12)} ${winner}`
    );
  }

  console.log('─'.repeat(70) + '\n');

  // Show sample visit with rich data
  const richVisit = visits.find(v => v.Title && v.Company && v.Industry);
  if (richVisit) {
    console.log('SAMPLE RICH VISIT:');
    console.log('─'.repeat(70));
    console.log(`Name: ${richVisit['First Name']} ${richVisit['Last Name']}`);
    console.log(`Title: ${richVisit.Title}`);
    console.log(`Company: ${richVisit.Company}`);
    console.log(`Location: ${richVisit.Location}`);
    console.log(`Industry: ${richVisit.Industry}`);
    console.log(`Connections: ${richVisit.Connections}`);
    console.log(`Email: ${richVisit.Email || 'none'}`);
    console.log(`Phone: ${richVisit.Phone || 'none'}`);
    console.log(`Has extended.positions: ${richVisit.extended?.positions?.length || 0}`);
    console.log(`Has extended.skills: ${richVisit.extended?.skills?.length || 0}`);
    console.log(`Has extended.schools: ${richVisit.extended?.schools?.length || 0}`);
    console.log('─'.repeat(70) + '\n');
  }

  // Show sample scan with rich data
  const richScan = scans.find(s => s.Title && s.Company);
  if (richScan) {
    console.log('SAMPLE RICH SCAN:');
    console.log('─'.repeat(70));
    console.log(`Name: ${richScan['First Name']} ${richScan['Last Name']}`);
    console.log(`Title: ${richScan.Title || 'none'}`);
    console.log(`Company: ${richScan.Company || 'none'}`);
    console.log(`Location: ${richScan.Location || 'none'}`);
    console.log(`Industry: ${richScan.Industry || 'none'}`);
    console.log(`Has positions: ${richScan.positions?.length || 0}`);
    console.log(`Has skills: ${richScan.skills?.length || 0}`);
    console.log(`Has schools: ${richScan.schools?.length || 0}`);
    console.log('─'.repeat(70) + '\n');
  }

  // Check people with both visits AND scans - which provides better data?
  console.log('ANALYZING PEOPLE WITH BOTH VISITS AND SCANS:');
  console.log('─'.repeat(70));

  const peopleWithBoth = await Person.find({
    'observations.visits.0': { $exists: true },
    'observations.scans.0': { $exists: true }
  }).limit(10).lean();

  console.log(`Found ${peopleWithBoth.length} people with both observation types\n`);

  let visitsBetter = 0;
  let scansBetter = 0;
  let tie = 0;

  for (const person of peopleWithBoth) {
    const visit = await Visit.findById(person.observations.visits[0]).lean();
    const scan = await Scan.findById(person.observations.scans[0]).lean();

    if (!visit || !scan) continue;

    // Count non-empty fields
    const visitFields = [
      visit['First Name'],
      visit['Last Name'],
      visit.Title,
      visit.Company,
      visit.Location,
      visit.Industry,
      visit.Connections,
      visit.Email,
      visit.Phone
    ].filter(f => f && f !== '').length;

    const scanFields = [
      scan['First Name'],
      scan['Last Name'],
      scan.Title,
      scan.Company,
      scan.Location,
      scan.Industry
    ].filter(f => f && f !== '').length;

    if (visitFields > scanFields) visitsBetter++;
    else if (scanFields > visitFields) scansBetter++;
    else tie++;
  }

  console.log(`Visits have more data: ${visitsBetter}`);
  console.log(`Scans have more data: ${scansBetter}`);
  console.log(`Tied: ${tie}\n`);

  console.log('─'.repeat(70));
  console.log('RECOMMENDATION:');
  console.log('─'.repeat(70));

  if (visitsBetter > scansBetter) {
    console.log('✓ VISITS contain significantly richer data than scans');
    console.log('  → Prioritize visit data when backfilling snapshots');
    console.log('  → Visits include: Title, Company, Industry, Email, Phone');
    console.log('  → Visits also have extended data: positions, skills, education');
  } else if (scansBetter > visitsBetter) {
    console.log('✓ SCANS contain richer data than visits');
    console.log('  → Prioritize scan data when backfilling snapshots');
  } else {
    console.log('≈ VISITS and SCANS have similar data completeness');
    console.log('  → Use most recent observation when backfilling');
  }

  console.log('─'.repeat(70) + '\n');
}

async function run() {
  try {
    await connectDB();
    await compareDataSources();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
