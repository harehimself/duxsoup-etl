/**
 * Identify Duplicate People by Case-Insensitive salesNavId
 *
 * Finds people who have the same salesNavId but different cases
 * (e.g., "ACwAAA123" and "acwaaa123" should be the same person)
 *
 * Run with:
 *   node scripts/identify-salesnavid-duplicates.js [--auto-merge]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const identityResolverService = require('../src/services/identityResolverService');
const logger = require('../src/utils/logger');

// Parse command line args
const args = process.argv.slice(2);
const autoMerge = args.includes('--auto-merge');

// Statistics
const stats = {
  totalPeople: 0,
  duplicateGroups: 0,
  totalDuplicates: 0,
  merged: 0,
  errors: 0,
};

/**
 * Main process
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Identify Duplicate People by salesNavId');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode: ${autoMerge ? 'AUTO-MERGE (will merge duplicates)' : 'IDENTIFY ONLY'}`);
  console.log('');

  // Connect to database
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected to MongoDB\n');

  // Get all people with salesNavId
  const people = await Person.find({
    'aliases.type': 'salesNavId',
  }).lean();

  stats.totalPeople = people.length;
  console.log(`Found ${people.length} people with salesNavId\n`);

  // Group by lowercase salesNavId
  const groups = new Map();

  for (const person of people) {
    const salesNavId = person.aliases.find(a => a.type === 'salesNavId')?.value;
    if (!salesNavId) continue;

    const key = salesNavId.toLowerCase();

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(person);
  }

  // Find duplicate groups (more than 1 person per lowercase salesNavId)
  const duplicateGroups = Array.from(groups.values()).filter(group => group.length > 1);

  stats.duplicateGroups = duplicateGroups.length;
  stats.totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0);

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Found ${duplicateGroups.length} duplicate groups`);
  console.log(`Total duplicate records: ${stats.totalDuplicates}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (duplicateGroups.length === 0) {
    console.log('✓ No duplicates found!');
    await mongoose.disconnect();
    return;
  }

  // Process each duplicate group
  for (let i = 0; i < duplicateGroups.length; i++) {
    const group = duplicateGroups[i];
    console.log(`\nGroup ${i + 1}/${duplicateGroups.length}:`);
    console.log(`  salesNavId: ${group[0].aliases.find(a => a.type === 'salesNavId')?.value}`);
    console.log(`  Duplicates: ${group.length} people\n`);

    // Show details of each person in the group
    group.forEach((person, index) => {
      const salesNavId = person.aliases.find(a => a.type === 'salesNavId')?.value;
      const username = person.aliases.find(a => a.type === 'linkedInUsername')?.value;
      const visitCount = person.observations?.visits?.length || 0;
      const scanCount = person.observations?.scans?.length || 0;

      console.log(`    [${index + 1}] ${person._id}`);
      console.log(`        salesNavId: ${salesNavId}`);
      console.log(`        username: ${username || 'none'}`);
      console.log(`        observations: ${visitCount} visits, ${scanCount} scans`);
      console.log(`        canonical_id: ${person.canonical_id || 'none'}`);
    });

    if (autoMerge) {
      try {
        // Determine winner using existing logic
        const winner = identityResolverService.determineWinner(group);
        const losers = group.filter(p => p._id !== winner._id);

        console.log(`\n    → Merging into: ${winner._id}`);

        // Merge the duplicates
        await identityResolverService.mergePeople(
          await Person.findById(winner._id),
          await Promise.all(losers.map(l => Person.findById(l._id))),
          {
            reason: 'case_sensitivity_duplicate',
            sourceObservationId: null,
          }
        );

        stats.merged += losers.length;
        console.log(`    ✓ Merged ${losers.length} duplicates`);
      } catch (error) {
        stats.errors++;
        console.error(`    ✗ Error merging group:`, error.message);
      }
    }
  }

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total people:           ${stats.totalPeople}`);
  console.log(`Duplicate groups:       ${stats.duplicateGroups}`);
  console.log(`Total duplicates:       ${stats.totalDuplicates}`);

  if (autoMerge) {
    console.log(`Merged:                 ${stats.merged}`);
    console.log(`Errors:                 ${stats.errors}`);
    console.log('\n✓ Database updated successfully');
  } else {
    console.log('\nℹ️  Run with --auto-merge to merge duplicates automatically');
  }

  await mongoose.disconnect();
}

// Run the script
main()
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
