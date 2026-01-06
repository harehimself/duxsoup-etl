#!/usr/bin/env node

/**
 * Seed Sample Data - For testing cutover
 *
 * Creates sample visits, scans, and people to demonstrate the system.
 */

const mongoose = require('mongoose');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const Person = require('../src/models/person');

async function seedData() {
  console.log('🌱 Seeding sample data...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    // Create sample visits
    const sampleVisits = [
      {
        id: 'visit-1',
        event_key: 'seed-visit-1',
        VisitTime: new Date('2024-01-15T10:00:00Z'),
        Profile: 'https://www.linkedin.com/in/johndoe',
        'First Name': 'John',
        'Last Name': 'Doe',
        Degree: '1st',
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAABCDEF123,NAME_SEARCH',
        Title: 'Senior Engineer',
        Company: 'TechCorp',
        Location: 'San Francisco, CA',
        rawData: {},
      },
      {
        id: 'visit-2',
        event_key: 'seed-visit-2',
        VisitTime: new Date('2024-01-16T14:00:00Z'),
        Profile: 'https://www.linkedin.com/in/janedoe',
        'First Name': 'Jane',
        'Last Name': 'Doe',
        Degree: '2nd',
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAAXYZ789,NAME_SEARCH',
        Title: 'Product Manager',
        Company: 'StartupCo',
        Location: 'New York, NY',
        rawData: {},
      },
      {
        id: 'visit-3',
        event_key: 'seed-visit-3',
        VisitTime: new Date('2024-01-17T09:00:00Z'),
        Profile: 'https://www.linkedin.com/in/bobsmith',
        'First Name': 'Bob',
        'Last Name': 'Smith',
        Degree: '3rd',
        Title: 'Marketing Director',
        Company: 'BigCorp',
        Location: 'Austin, TX',
        rawData: {},
      },
    ];

    console.log('Creating visits...');
    await Visit.insertMany(sampleVisits);
    console.log(`✓ Created ${sampleVisits.length} visits\n`);

    // Create sample scans
    const sampleScans = [
      {
        id: 'scan-1',
        event_key: 'seed-scan-1',
        ScanTime: new Date('2024-01-18T11:00:00Z'),
        Profile: 'https://www.linkedin.com/in/johndoe',
        'First Name': 'John',
        'Last Name': 'Doe',
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAABCDEF123,NAME_SEARCH',
        Title: 'Senior Engineer',
        Company: 'TechCorp',
        CompanyID: '12345',
        Location: 'San Francisco, CA',
        Industry: 'Technology',
        'Connection Degree': '1st',
        rawData: {},
      },
      {
        id: 'scan-2',
        event_key: 'seed-scan-2',
        ScanTime: new Date('2024-01-19T15:00:00Z'),
        Profile: 'https://www.linkedin.com/in/alicejones',
        'First Name': 'Alice',
        'Last Name': 'Jones',
        SalesProfile: 'https://www.linkedin.com/sales/lead/ACwAAAQWE456,NAME_SEARCH',
        Title: 'Data Scientist',
        Company: 'DataCo',
        CompanyID: '67890',
        Location: 'Seattle, WA',
        Industry: 'Technology',
        rawData: {},
      },
    ];

    console.log('Creating scans...');
    await Scan.insertMany(sampleScans);
    console.log(`✓ Created ${sampleScans.length} scans\n`);

    // Create sample people (canonical)
    const samplePeople = [
      {
        _id: 'ACwAAABCDEF123',
        person_id: 'ACwAAABCDEF123',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAABCDEF123' },
          { type: 'publicUrl', value: 'linkedin.com/in/johndoe' },
        ],
        snapshot: {
          firstName: 'John',
          lastName: 'Doe',
          fullName: 'John Doe',
          currentTitle: 'Senior Engineer',
          currentCompany: 'TechCorp',
          location: 'San Francisco, CA',
          degree: '1st',
        },
        observations: {
          visits: [sampleVisits[0]._id],
          scans: [sampleScans[0]._id],
        },
        meta: {
          last_observed_at: new Date('2024-01-18T11:00:00Z'),
          observations_count: 2,
        },
      },
      {
        _id: 'ACwAAAXYZ789',
        person_id: 'ACwAAAXYZ789',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAAXYZ789' },
          { type: 'publicUrl', value: 'linkedin.com/in/janedoe' },
        ],
        snapshot: {
          firstName: 'Jane',
          lastName: 'Doe',
          fullName: 'Jane Doe',
          currentTitle: 'Product Manager',
          currentCompany: 'StartupCo',
          location: 'New York, NY',
          degree: '2nd',
        },
        observations: {
          visits: [sampleVisits[1]._id],
          scans: [],
        },
        meta: {
          last_observed_at: new Date('2024-01-16T14:00:00Z'),
          observations_count: 1,
        },
      },
      {
        _id: 'ACwAAAQWE456',
        person_id: 'ACwAAAQWE456',
        aliases: [
          { type: 'salesNavId', value: 'ACwAAAQWE456' },
          { type: 'publicUrl', value: 'linkedin.com/in/alicejones' },
        ],
        snapshot: {
          firstName: 'Alice',
          lastName: 'Jones',
          fullName: 'Alice Jones',
          currentTitle: 'Data Scientist',
          currentCompany: 'DataCo',
          location: 'Seattle, WA',
        },
        observations: {
          visits: [],
          scans: [sampleScans[1]._id],
        },
        meta: {
          last_observed_at: new Date('2024-01-19T15:00:00Z'),
          observations_count: 1,
        },
      },
      {
        _id: 'linkedin.com/in/bobsmith',
        person_id: 'linkedin.com/in/bobsmith',
        aliases: [
          { type: 'publicUrl', value: 'linkedin.com/in/bobsmith' },
        ],
        snapshot: {
          firstName: 'Bob',
          lastName: 'Smith',
          fullName: 'Bob Smith',
          currentTitle: 'Marketing Director',
          currentCompany: 'BigCorp',
          location: 'Austin, TX',
          degree: '3rd',
        },
        observations: {
          visits: [sampleVisits[2]._id],
          scans: [],
        },
        meta: {
          last_observed_at: new Date('2024-01-17T09:00:00Z'),
          observations_count: 1,
        },
      },
    ];

    console.log('Creating people...');
    await Person.insertMany(samplePeople);
    console.log(`✓ Created ${samplePeople.length} people\n`);

    // Summary
    console.log('✅ Sample data seeded successfully!\n');
    console.log('Summary:');
    console.log(`  Visits: ${sampleVisits.length}`);
    console.log(`  Scans: ${sampleScans.length}`);
    console.log(`  People: ${samplePeople.length}`);
    console.log('');
    console.log('Note: 1 person (Bob Smith) has URL-only ID (upgradable)');
    console.log('      3 people have Sales Navigator IDs');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: ./scripts/pre-flight-check.sh');
    console.log('  2. Test read endpoints:');
    console.log('     curl http://localhost:3000/api/people/ACwAAABCDEF123');
    console.log('     curl http://localhost:3000/api/people/by-alias/linkedin.com/in/johndoe');
    console.log('');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding data:', error.message);
    process.exit(1);
  }
}

seedData();
