/**
 * Backfill Seniority Tiers for Existing Roles
 *
 * This script parses all existing role titles in the Person collection
 * and adds seniority and seniorityRank fields to each role.
 *
 * Usage:
 *   npm run backfill:seniority          # Dry run (default)
 *   npm run backfill:seniority -- --execute  # Execute the migration
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Person = require('../src/models/person');
const { parseTitle, getHighestSeniorityRole } = require('../src/utils/titleParser');
const logger = require('../src/utils/logger');

// Parse command line arguments
const isDryRun = !process.argv.includes('--execute');

async function backfillSeniority() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is required');
    }

    logger.info('Connecting to MongoDB...', { mongoUri: mongoUri.substring(0, 30) + '...' });
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
    logger.info('Connected to MongoDB');

    // Find all people with roles
    const people = await Person.find({
      'snapshot.roles.0': { $exists: true }, // Has at least one role
    }).select('_id snapshot.roles');

    logger.info(`Found ${people.length} people with roles`);

    let updatedPeopleCount = 0;
    let updatedRolesCount = 0;
    let errorCount = 0;

    for (const person of people) {
      try {
        let personModified = false;

        // Parse seniority for each role
        if (person.snapshot.roles && person.snapshot.roles.length > 0) {
          for (const role of person.snapshot.roles) {
            // Skip if already has seniority
            if (role.seniority && role.seniorityRank) {
              continue;
            }

            if (role.title) {
              const parsed = parseTitle(role.title);
              role.seniority = parsed.seniority;
              role.seniorityRank = parsed.seniorityRank;
              updatedRolesCount++;
              personModified = true;

              if (isDryRun) {
                logger.debug('Would update role', {
                  personId: person._id,
                  title: role.title,
                  seniority: parsed.seniority,
                  rank: parsed.seniorityRank,
                });
              }
            }
          }
        }

        // Save if modified
        if (personModified) {
          if (!isDryRun) {
            await person.save();
          }
          updatedPeopleCount++;
        }
      } catch (error) {
        errorCount++;
        logger.error('Error processing person', {
          personId: person._id,
          error: error.message,
        });
      }
    }

    logger.info('Backfill complete', {
      mode: isDryRun ? 'DRY RUN' : 'EXECUTED',
      totalPeople: people.length,
      updatedPeople: updatedPeopleCount,
      updatedRoles: updatedRolesCount,
      errors: errorCount,
    });

    if (isDryRun) {
      logger.info('This was a dry run. Run with --execute to apply changes.');
    }

    // Show sample of highest seniority roles
    if (!isDryRun && updatedPeopleCount > 0) {
      logger.info('Recalculating derived metrics with highest seniority...');

      // Update derived metrics for all people
      const peopleForMetrics = await Person.find({
        'snapshot.roles.0': { $exists: true },
      });

      let metricsUpdated = 0;
      for (const person of peopleForMetrics) {
        const highestRole = getHighestSeniorityRole(person.snapshot.roles);

        if (highestRole) {
          person.derived = person.derived || {};
          person.derived.highestSeniority = highestRole.seniority;
          person.derived.highestSeniorityRank = highestRole.seniorityRank;
          person.derived.highestSeniorityRoleTitle = highestRole.title;
          person.derived.highestSeniorityRoleCompany = highestRole.companyName;

          await person.save();
          metricsUpdated++;
        }
      }

      logger.info('Updated derived metrics', { count: metricsUpdated });

      // Show sample distribution
      const distribution = await Person.aggregate([
        { $unwind: '$snapshot.roles' },
        {
          $group: {
            _id: '$snapshot.roles.seniority',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]);

      logger.info('Seniority distribution across all roles:', distribution);
    }
  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
}

// Run the migration
backfillSeniority().catch((error) => {
  logger.error('Unhandled error', { error: error.message });
  process.exit(1);
});
