#!/usr/bin/env node
/**
 * Investigate Records
 * Examines sample data to understand schema and linkage issues
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const DeadLetter = require('../src/models/deadLetter');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m'
};

function section(title) {
  console.log(`\n${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log('─'.repeat(60));
}

function prettyPrint(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    if (obj.length > 3) {
      console.log(`${spaces}[${obj.length} items] (showing first 3):`);
      obj.slice(0, 3).forEach((item, i) => {
        console.log(`${spaces}  [${i}]:`);
        prettyPrint(item, indent + 2);
      });
    } else {
      obj.forEach((item, i) => {
        console.log(`${spaces}[${i}]:`);
        prettyPrint(item, indent + 1);
      });
    }
  } else if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        console.log(`${spaces}${key}: ${colors.yellow}null${colors.reset}`);
      } else if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        console.log(`${spaces}${key}:`);
        prettyPrint(value, indent + 1);
      } else if (Array.isArray(value)) {
        console.log(`${spaces}${key}: [${value.length} items]`);
        if (value.length > 0 && value.length <= 3) {
          prettyPrint(value, indent + 1);
        } else if (value.length > 3) {
          console.log(`${spaces}  (showing first 3)`);
          prettyPrint(value.slice(0, 3), indent + 1);
        }
      } else if (value instanceof Date) {
        console.log(`${spaces}${key}: ${value.toISOString()}`);
      } else if (typeof value === 'string' && value.length > 100) {
        console.log(`${spaces}${key}: "${value.substring(0, 100)}..." (${value.length} chars)`);
      } else {
        console.log(`${spaces}${key}: ${JSON.stringify(value)}`);
      }
    }
  } else {
    console.log(`${spaces}${JSON.stringify(obj)}`);
  }
}

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  const environment = process.env.NODE_ENV || 'development';
  await mongoose.connect(mongoUri);
  console.log(`${colors.green}Connected to MongoDB (${environment})${colors.reset}`);
}

async function investigatePeople() {
  section('PEOPLE COLLECTION - Sample Records');

  const people = await Person.find().limit(3).lean();
  console.log(`\nTotal people: ${await Person.countDocuments()}`);
  console.log(`Showing 3 samples:\n`);

  people.forEach((person, i) => {
    console.log(`\n${colors.bright}Person ${i + 1}:${colors.reset}`);
    prettyPrint(person, 1);
  });

  // Check structure
  const samplePerson = people[0];
  section('PERSON SCHEMA ANALYSIS');
  console.log('Fields present:', Object.keys(samplePerson || {}).join(', '));
  console.log('Has visits field:', 'visits' in (samplePerson || {}));
  console.log('Has scans field:', 'scans' in (samplePerson || {}));
  console.log('Has observations field:', 'observations' in (samplePerson || {}));
}

async function investigateVisits() {
  section('VISITS COLLECTION - Sample Records');

  const visits = await Visit.find().limit(3).lean();
  console.log(`\nTotal visits: ${await Visit.countDocuments()}`);
  console.log(`Showing 3 samples:\n`);

  visits.forEach((visit, i) => {
    console.log(`\n${colors.bright}Visit ${i + 1}:${colors.reset}`);
    prettyPrint(visit, 1);
  });

  // Check person_id references
  section('VISIT LINKAGE ANALYSIS');
  const sampleVisit = visits[0];
  if (sampleVisit) {
    console.log('person_id field:', sampleVisit.person_id);
    console.log('person_id type:', typeof sampleVisit.person_id);

    if (sampleVisit.person_id) {
      const personExists = await Person.findById(sampleVisit.person_id);
      console.log(`Person with _id="${sampleVisit.person_id}" exists:`, !!personExists);

      if (!personExists) {
        // Try to find by aliases
        console.log('\nSearching for person by potential identifiers from visit...');
        const identifiers = {
          sales_nav_id: sampleVisit.sales_nav_id,
          numeric_id: sampleVisit.numeric_id,
          public_url: sampleVisit.public_url
        };

        for (const [key, value] of Object.entries(identifiers)) {
          if (value) {
            const found = await Person.findOne({
              'aliases.value': value
            });
            console.log(`  - Found by ${key} (${value}):`, !!found);
            if (found) {
              console.log(`    Person _id: ${found._id}`);
              console.log(`    Person canonical_id: ${found.canonical_id}`);
            }
          }
        }
      }
    }
  }
}

async function investigateScans() {
  section('SCANS COLLECTION - Sample Records');

  const scans = await Scan.find().limit(3).lean();
  console.log(`\nTotal scans: ${await Scan.countDocuments()}`);
  console.log(`Showing 3 samples:\n`);

  scans.forEach((scan, i) => {
    console.log(`\n${colors.bright}Scan ${i + 1}:${colors.reset}`);
    prettyPrint(scan, 1);
  });

  // Check person_id references
  section('SCAN LINKAGE ANALYSIS');
  const sampleScan = scans[0];
  if (sampleScan) {
    console.log('person_id field:', sampleScan.person_id);
    console.log('person_id type:', typeof sampleScan.person_id);

    if (sampleScan.person_id) {
      const personExists = await Person.findById(sampleScan.person_id);
      console.log(`Person with _id="${sampleScan.person_id}" exists:`, !!personExists);

      if (!personExists) {
        console.log('\nSearching for person by potential identifiers from scan...');
        const identifiers = {
          sales_nav_id: sampleScan.sales_nav_id,
          numeric_id: sampleScan.numeric_id,
          public_url: sampleScan.public_url
        };

        for (const [key, value] of Object.entries(identifiers)) {
          if (value) {
            const found = await Person.findOne({
              'aliases.value': value
            });
            console.log(`  - Found by ${key} (${value}):`, !!found);
            if (found) {
              console.log(`    Person _id: ${found._id}`);
              console.log(`    Person canonical_id: ${found.canonical_id}`);
            }
          }
        }
      }
    }
  }
}

async function investigateDeadLetters() {
  section('DEAD LETTERS - Sample Records');

  const deadLetters = await DeadLetter.find().limit(3).lean();
  console.log(`\nTotal dead letters: ${await DeadLetter.countDocuments()}`);
  console.log(`Showing 3 samples:\n`);

  deadLetters.forEach((dl, i) => {
    console.log(`\n${colors.bright}Dead Letter ${i + 1}:${colors.reset}`);
    prettyPrint(dl, 1);
  });
}

async function crossReferenceCheck() {
  section('CROSS-REFERENCE CHECK');

  // Get a person and check if their visits/scans exist
  const person = await Person.findOne().lean();
  if (person) {
    console.log(`\nChecking Person: ${person._id}`);
    console.log(`canonical_id: ${person.canonical_id}`);

    // Check if visits reference this person
    const visitsForPerson = await Visit.countDocuments({ person_id: person._id });
    const scansForPerson = await Scan.countDocuments({ person_id: person._id });

    console.log(`Visits referencing this person._id: ${visitsForPerson}`);
    console.log(`Scans referencing this person._id: ${scansForPerson}`);

    // Check by canonical_id
    const visitsByCanonical = await Visit.countDocuments({ person_id: person.canonical_id });
    const scansByCanonical = await Scan.countDocuments({ person_id: person.canonical_id });

    console.log(`Visits referencing this person.canonical_id: ${visitsByCanonical}`);
    console.log(`Scans referencing this person.canonical_id: ${scansByCanonical}`);

    // Check if person has any alias values that match observation identifiers
    if (person.aliases && person.aliases.length > 0) {
      console.log(`\nPerson aliases (${person.aliases.length}):`);
      for (const alias of person.aliases.slice(0, 5)) {
        console.log(`  - ${alias.type}: ${alias.value}`);

        // Check if any visits have this as an identifier
        const visitsWithAlias = await Visit.countDocuments({
          $or: [
            { sales_nav_id: alias.value },
            { numeric_id: alias.value },
            { public_url: alias.value }
          ]
        });

        if (visitsWithAlias > 0) {
          console.log(`    → ${visitsWithAlias} visits have this identifier`);
        }
      }
    }
  }

  // Get a visit and check if its person exists
  const visit = await Visit.findOne().lean();
  if (visit) {
    console.log(`\n\nChecking Visit: ${visit._id}`);
    console.log(`person_id: ${visit.person_id}`);
    console.log(`sales_nav_id: ${visit.sales_nav_id || 'none'}`);
    console.log(`numeric_id: ${visit.numeric_id || 'none'}`);
    console.log(`public_url: ${visit.public_url || 'none'}`);

    const personById = await Person.findById(visit.person_id);
    console.log(`Person found by visit.person_id: ${!!personById}`);

    if (!personById) {
      // Try to find by identifiers
      console.log('\nTrying to find person by identifiers...');

      const identifiers = [
        { field: 'sales_nav_id', value: visit.sales_nav_id },
        { field: 'numeric_id', value: visit.numeric_id },
        { field: 'public_url', value: visit.public_url }
      ];

      for (const id of identifiers) {
        if (id.value) {
          const foundById = await Person.findById(id.value);
          const foundByAlias = await Person.findOne({ 'aliases.value': id.value });
          const foundByCanonical = await Person.findOne({ canonical_id: id.value });

          console.log(`\n  ${id.field}: ${id.value}`);
          console.log(`    - Found as Person._id: ${!!foundById}`);
          console.log(`    - Found in Person.aliases: ${!!foundByAlias}`);
          console.log(`    - Found as Person.canonical_id: ${!!foundByCanonical}`);

          if (foundByAlias) {
            console.log(`      Person._id: ${foundByAlias._id}`);
            console.log(`      Person.canonical_id: ${foundByAlias.canonical_id}`);
          }
        }
      }
    }
  }
}

async function investigate() {
  console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}     DATABASE INVESTIGATION REPORT${colors.reset}`);
  console.log(`${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

  try {
    await connectDB();

    await investigatePeople();
    await investigateVisits();
    await investigateScans();
    await investigateDeadLetters();
    await crossReferenceCheck();

    console.log(`\n${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  } catch (error) {
    console.error(`\n${colors.yellow}✗ Investigation failed:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

investigate();
