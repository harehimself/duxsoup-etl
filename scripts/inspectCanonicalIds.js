#!/usr/bin/env node

/**
 * Inspect Canonical IDs
 *
 * Shows sample canonical_id records and their identifier types
 */

const mongoose = require('mongoose');
const Person = require('../src/models/person');

async function inspectCanonicalIds() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);

    console.log('📊 Canonical ID Implementation Status\n');
    console.log('═══════════════════════════════════════════════════════\n');

    const people = await Person.find()
      .select('_id canonical_id aliases snapshot.fullName')
      .limit(10)
      .lean();

    console.log(`Total records: ${people.length}\n`);

    people.forEach((person, i) => {
      console.log(`${i + 1}. Person ID: ${person._id}`);
      console.log(`   Name: ${person.snapshot?.fullName || 'Unknown'}`);
      console.log(`   Canonical ID: ${person.canonical_id}`);

      if (person.aliases && person.aliases.length > 0) {
        console.log(`   Aliases:`);
        person.aliases.forEach(alias => {
          console.log(`     - ${alias.type}: ${alias.value}`);
        });
      } else {
        console.log(`   Aliases: None`);
      }
      console.log('');
    });

    // Aggregate by identifier type
    const pipeline = [
      { $unwind: { path: '$aliases', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$aliases.type',
          count: { $sum: 1 },
          sample: { $first: '$aliases.value' }
        }
      },
      { $sort: { count: -1 } }
    ];

    const identifierDistribution = await Person.aggregate(pipeline);

    console.log('═══════════════════════════════════════════════════════');
    console.log('           IDENTIFIER TYPE DISTRIBUTION                ');
    console.log('═══════════════════════════════════════════════════════\n');

    identifierDistribution.forEach(dist => {
      const type = dist._id || 'No aliases';
      console.log(`${type}: ${dist.count} record(s)`);
      if (dist.sample) {
        console.log(`  Example: ${dist.sample}\n`);
      }
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

inspectCanonicalIds();
