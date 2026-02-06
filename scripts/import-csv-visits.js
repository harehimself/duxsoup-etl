const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Visit = require('../src/models/visit');
const Person = require('../src/models/person');
const Company = require('../src/models/company');
const Location = require('../src/models/location');
const { parseLocation } = require('../src/utils/location-parser');
const { parseSafeDate, parseLinkedInDate } = require('../src/utils/date-parser');
const { computeCanonicalId } = require('../src/utils/identityMatcher');
const identityResolver = require('../src/services/identityResolverService');
const logger = require('../src/utils/logger');

/**
 * Import CSV Visits - Comprehensive Data Enrichment
 *
 * Imports DuxSoup CSV export and enriches the database with:
 * - Visit observations (raw events)
 * - Person snapshots (enriched with skills, roles, contact info)
 * - Company records (with metadata)
 * - Location records (parsed and structured)
 *
 * Usage:
 *   node scripts/import-csv-visits.js <csv-file-path> [--dry-run] [--batch-size=100]
 *
 * Example:
 *   node scripts/import-csv-visits.js visits.csv --dry-run
 *   node scripts/import-csv-visits.js visits.csv --batch-size=50
 */

const BATCH_SIZE = parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 100;
const DRY_RUN = process.argv.includes('--dry-run');
const CSV_FILE = process.argv[2];

// Statistics tracking
const stats = {
  totalRows: 0,
  visitsCreated: 0,
  visitsUpdated: 0,
  visitsFailed: 0,
  peopleCreated: 0,
  peopleUpdated: 0,
  companiesCreated: 0,
  companiesUpdated: 0,
  locationsCreated: 0,
  locationsUpdated: 0,
  skillsAdded: 0,
  rolesAdded: 0,
  errors: [],
};

/**
 * Extract skills from CSV row (Skill-0 through Skill-99)
 */
function extractSkills(row) {
  const skills = [];
  for (let i = 0; i <= 99; i++) {
    const skillKey = `Skill-${i}`;
    if (row[skillKey] && row[skillKey].trim()) {
      skills.push(row[skillKey].trim());
    }
  }
  return skills;
}

/**
 * Extract position history from CSV row (Position-0 through Position-7)
 */
function extractPositions(row) {
  const positions = [];
  for (let i = 0; i <= 7; i++) {
    const company = row[`Position-${i}-Company`];
    const title = row[`Position-${i}-Title`];
    const description = row[`Position-${i}-Description`];
    const from = row[`Position-${i}-From`];
    const to = row[`Position-${i}-To`];
    const location = row[`Position-${i}-Location`];

    // Only add if company or title exists
    if (company || title) {
      const startDate = parseLinkedInDate(from);
      const endDate = parseLinkedInDate(to);

      // Validate: endDate must be >= startDate (skip invalid roles)
      if (startDate && endDate && endDate < startDate) {
        logger.warn('Skipping role with invalid dates', {
          company: company?.trim(),
          title: title?.trim(),
          from,
          to,
          reason: 'endDate before startDate',
        });
        continue; // Skip this invalid role
      }

      const position = {
        company: company?.trim() || null,
        title: title?.trim() || null,
        description: description?.trim() || null,
        from: from?.trim() || null,
        to: to?.trim() || null,
        location: location?.trim() || null,
        startDate,
        endDate,
        isCurrent: !to || to.toLowerCase() === 'present',
      };
      positions.push(position);
    }
  }
  return positions;
}

/**
 * Build aliases array from CSV row
 */
function buildAliases(row) {
  const aliases = [];

  // Sales Navigator ID (most stable)
  if (row.salesNavId) {
    aliases.push({ type: 'salesNavId', value: row.salesNavId.trim() });
  }

  // DuxSoup ID
  if (row.duxsoupId) {
    aliases.push({ type: 'duxsoupId', value: row.duxsoupId.trim() });
  }

  // Profile URLs
  if (row.Profile) {
    aliases.push({ type: 'profileUrl', value: row.Profile.trim() });
    // Extract username from profile URL
    const usernameMatch = row.Profile.match(/linkedin\.com\/in\/([^/?]+)/);
    if (usernameMatch) {
      aliases.push({ type: 'linkedInUsername', value: usernameMatch[1] });
    }
  }

  if (row.SalesProfile) {
    aliases.push({ type: 'salesUrl', value: row.SalesProfile.trim() });
  }

  if (row.RecruiterProfile) {
    aliases.push({ type: 'recruiterUrl', value: row.RecruiterProfile.trim() });
  }

  return aliases;
}

/**
 * Create or update Visit observation
 */
async function processVisit(row) {
  try {
    const visitData = {
      id: row.duxsoupId,
      VisitTime: parseSafeDate(row.VisitTime),
      Profile: row.Profile || null,
      'First Name': row['First Name'],
      'Last Name': row['Last Name'] || null,
      'Middle Name': row['Middle Name'] || null,
      Degree: row.Degree || '1',
      SalesProfile: row.SalesProfile || null,
      RecruiterProfile: row.RecruiterProfile || null,
      Picture: row.Picture || null,
      Connections: row.Connections || null,
      Summary: row.Summary || null,
      Title: row.Title || null,
      From: row.From || null,
      Company: row.Company || null,
      CompanyProfile: row.CompanyProfile || null,
      CompanyWebsite: row.CompanyWebsite || null,
      PersonalWebsite: row.PersonalWebsite || null,
      Email: row.Email || null,
      Phone: row.Phone || null,
      IM: row.IM || null,
      Twitter: row.Twitter || null,
      Location: row.Location || null,
      Industry: row.Industry || null,
      'My Tags': row['My Tags'] ? row['My Tags'].split(',').map(t => t.trim()) : [],
      'My Notes': row['My Notes'] || null,
    };

    // Parse location
    if (row.Location) {
      const parsedLocation = parseLocation(row.Location);
      Object.assign(visitData, {
        city: parsedLocation.city,
        state: parsedLocation.state,
        stateCode: parsedLocation.stateCode,
        country: parsedLocation.country,
        countryCode: parsedLocation.countryCode,
        province: parsedLocation.province,
        region: parsedLocation.region,
        locationType: parsedLocation.locationType,
      });
    }

    // Store skills and positions in extended field
    const skills = extractSkills(row);
    const positions = extractPositions(row);

    visitData.extended = {
      skills,
      positions,
    };

    // Store full raw CSV data
    visitData.rawData = { ...row };

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would create visit: ${visitData.id}`);
      stats.visitsCreated++;
      return visitData;
    }

    // Check if visit already exists
    const existingVisit = await Visit.findOne({ id: visitData.id });
    if (existingVisit) {
      console.log(`Visit already exists: ${visitData.id} - skipping`);
      stats.visitsUpdated++;
      return existingVisit;
    }

    // Create new visit
    const visit = await Visit.create(visitData);
    stats.visitsCreated++;
    return visit;
  } catch (error) {
    stats.visitsFailed++;
    stats.errors.push({
      row: row.duxsoupId,
      type: 'visit',
      error: error.message,
    });
    logger.error('Failed to process visit', {
      duxsoupId: row.duxsoupId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Create or update Company record
 *
 * NOTE: Skipped for CSV import - Company model requires numeric LinkedIn company ID
 * which is not available in CSV export. Company names are preserved in Visit.Company
 * and Person.snapshot.currentCompany fields.
 */
async function processCompany(row) {
  // Skip company creation - requires numeric ID not available in CSV
  if (DRY_RUN && row.Company) {
    console.log(`[DRY RUN] Would skip company (no numeric ID): ${row.Company}`);
  }
  return null;
}

/**
 * Create or update Location record
 *
 * NOTE: Skipped for CSV import - Location model requires normalized slug _id
 * and canonical_id. Location data is preserved in Visit.Location and parsed
 * into Visit city/state/country fields, and Person.snapshot location fields.
 */
async function processLocation(row) {
  // Skip location creation - requires normalized slug ID
  // Location data is preserved in Visit and Person records
  if (DRY_RUN && row.Location) {
    console.log(`[DRY RUN] Would skip location (no slug ID): ${row.Location}`);
  }
  return null;
}

/**
 * Create or update Person snapshot with enrichment
 */
async function processPerson(row, visit) {
  try {
    // Build aliases for identity resolution
    const aliases = buildAliases(row);

    if (aliases.length === 0) {
      logger.warn('No aliases found for person', { duxsoupId: row.duxsoupId });
      return null;
    }

    // Find existing person by any alias
    const existingPeople = await identityResolver.findByAnyAlias(aliases);

    let person;
    const skills = extractSkills(row);
    const positions = extractPositions(row);

    // Parse location
    const parsedLocation = row.Location ? parseLocation(row.Location) : {};

    // Build snapshot data
    const snapshotData = {
      firstName: row['First Name']?.trim() || null,
      middleName: row['Middle Name']?.trim() || null,
      lastName: row['Last Name']?.trim() || null,
      fullName: [row['First Name'], row['Middle Name'], row['Last Name']]
        .filter(Boolean)
        .join(' ')
        .trim() || null,
      currentTitle: row.Title?.trim() || null,
      currentCompany: row.Company?.trim() || null,
      currentCompanyProfile: row.CompanyProfile?.trim() || null,
      location: row.Location?.trim() || null,
      city: parsedLocation.city,
      state: parsedLocation.state,
      stateCode: parsedLocation.stateCode,
      country: parsedLocation.country,
      countryCode: parsedLocation.countryCode,
      province: parsedLocation.province,
      region: parsedLocation.region,
      locationType: parsedLocation.locationType,
      industry: row.Industry?.trim() || null,
      connections: row.Connections ? parseInt(row.Connections) : null,
      summary: row.Summary?.trim() || null,
      email: row.Email?.trim() || null,
      phone: row.Phone?.trim() || null,
      twitter: row.Twitter?.trim() || null,
      profilePicture: row.Picture?.trim() || null,
      personalWebsite: row.PersonalWebsite?.trim() || null,
      companyWebsite: row.CompanyWebsite?.trim() || null,
      degree: row.Degree ? parseInt(row.Degree) : 1,
      skills: skills,
    };

    // Build roles from positions
    const roles = positions.map(pos => ({
      title: pos.title,
      companyName: pos.company,
      location: pos.location,
      description: pos.description,
      startDate: pos.startDate,
      endDate: pos.endDate,
      isCurrent: pos.isCurrent,
    }));

    snapshotData.roles = roles;

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would process person: ${snapshotData.fullName}`);
      if (existingPeople.length > 0) {
        console.log(`  - Would update existing person: ${existingPeople[0]._id}`);
        stats.peopleUpdated++;
      } else {
        console.log(`  - Would create new person`);
        stats.peopleCreated++;
      }
      stats.skillsAdded += skills.length;
      stats.rolesAdded += roles.length;
      return null;
    }

    if (existingPeople.length > 0) {
      // Update existing person
      person = existingPeople[0];

      // Merge aliases (avoid duplicates)
      const existingAliasValues = new Set(person.aliases.map(a => a.value));
      const newAliases = aliases.filter(a => !existingAliasValues.has(a.value));
      if (newAliases.length > 0) {
        person.aliases.push(...newAliases);
      }

      // Enrich snapshot with new data (preserve existing data, add new)
      Object.keys(snapshotData).forEach(key => {
        if (key === 'skills') {
          // Merge skills (avoid duplicates)
          const existingSkills = new Set(person.snapshot.skills || []);
          const newSkills = skills.filter(s => !existingSkills.has(s));
          if (newSkills.length > 0) {
            person.snapshot.skills = [...(person.snapshot.skills || []), ...newSkills];
            stats.skillsAdded += newSkills.length;
          }
        } else if (key === 'roles') {
          // Merge roles (avoid duplicates based on company + title + dates)
          const existingRoles = person.snapshot.roles || [];
          const newRoles = roles.filter(newRole => {
            return !existingRoles.some(existingRole =>
              existingRole.companyName === newRole.companyName &&
              existingRole.title === newRole.title &&
              existingRole.startDate?.getTime() === newRole.startDate?.getTime()
            );
          });
          if (newRoles.length > 0) {
            person.snapshot.roles = [...existingRoles, ...newRoles];
            stats.rolesAdded += newRoles.length;
          }
        } else if (snapshotData[key] && !person.snapshot[key]) {
          // Only update if we have new data and field is empty
          person.snapshot[key] = snapshotData[key];
        }
      });

      // Add visit reference
      if (visit && !person.observations.visits.includes(visit._id)) {
        person.observations.visits.push(visit._id);
      }

      // Update metadata
      person.meta.lastObservedAt = visit?.VisitTime || new Date();
      person.meta.lastObservation = {
        type: 'visit',
        id: visit?._id,
        observedAt: visit?.VisitTime || new Date(),
      };
      person.meta.observationsCount = (person.meta.observationsCount || 0) + 1;

      await person.save();
      stats.peopleUpdated++;
      console.log(`Updated person: ${person.snapshot.fullName} (${person._id})`);
    } else {
      // Create new person
      const primaryAlias = aliases.find(a => a.type === 'salesNavId') || aliases[0];
      const personId = primaryAlias.value;
      const canonicalId = computeCanonicalId(personId);

      person = await Person.create({
        _id: personId,
        canonical_id: canonicalId,
        aliases: aliases,
        snapshot: snapshotData,
        observations: {
          visits: visit ? [visit._id] : [],
          scans: [],
        },
        meta: {
          lastObservedAt: visit?.VisitTime || new Date(),
          lastObservation: {
            type: 'visit',
            id: visit?._id,
            observedAt: visit?.VisitTime || new Date(),
          },
          observationsCount: 1,
        },
      });

      stats.peopleCreated++;
      stats.skillsAdded += skills.length;
      stats.rolesAdded += roles.length;
      console.log(`Created person: ${person.snapshot.fullName} (${person._id})`);
    }

    return person;
  } catch (error) {
    stats.errors.push({
      row: row.duxsoupId,
      type: 'person',
      error: error.message,
    });
    logger.error('Failed to process person', {
      duxsoupId: row.duxsoupId,
      error: error.message,
      stack: error.stack,
    });
    return null;
  }
}

/**
 * Process a batch of CSV rows
 */
async function processBatch(rows) {
  for (const row of rows) {
    try {
      stats.totalRows++;

      // 1. Create Visit observation
      const visit = await processVisit(row);

      // 2. Create/Update Person snapshot with enrichment
      // Note: Company and Location creation skipped (require IDs not in CSV)
      // Company/location data is preserved in Visit and Person snapshot fields
      await processPerson(row, visit);

      if (stats.totalRows % 50 === 0) {
        console.log(`\nProcessed ${stats.totalRows} rows...`);
        printStats();
      }
    } catch (error) {
      console.error(`Error processing row ${row.duxsoupId}:`, error.message);
    }
  }
}

/**
 * Print statistics
 */
function printStats() {
  console.log('\n========================================');
  console.log('IMPORT STATISTICS');
  console.log('========================================');
  console.log(`Total Rows Processed:     ${stats.totalRows}`);
  console.log(`\nVisits:`);
  console.log(`  Created:                ${stats.visitsCreated}`);
  console.log(`  Skipped (exists):       ${stats.visitsUpdated}`);
  console.log(`  Failed:                 ${stats.visitsFailed}`);
  console.log(`\nPeople:`);
  console.log(`  Created:                ${stats.peopleCreated}`);
  console.log(`  Updated (enriched):     ${stats.peopleUpdated}`);
  console.log(`  Skills Added:           ${stats.skillsAdded}`);
  console.log(`  Roles Added:            ${stats.rolesAdded}`);
  console.log(`\nNote: Company and Location records skipped (require IDs not in CSV).`);
  console.log(`      Data preserved in Visit and Person snapshot fields.`);
  console.log(`\nErrors:                   ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    console.log('\nFirst 10 errors:');
    stats.errors.slice(0, 10).forEach(err => {
      console.log(`  - Row ${err.row} (${err.type}): ${err.error}`);
    });
  }
  console.log('========================================\n');
}

/**
 * Main import function
 */
async function main() {
  // Validate arguments
  if (!CSV_FILE) {
    console.error('Error: CSV file path is required');
    console.error('Usage: node scripts/import-csv-visits.js <csv-file-path> [--dry-run] [--batch-size=100]');
    process.exit(1);
  }

  const csvPath = path.isAbsolute(CSV_FILE) ? CSV_FILE : path.join(process.cwd(), CSV_FILE);

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  await database.connect();

  console.log('\n========================================');
  console.log('CSV VISITS IMPORT - COMPREHENSIVE ENRICHMENT');
  console.log('========================================\n');
  console.log(`CSV File:         ${csvPath}`);
  console.log(`Batch Size:       ${BATCH_SIZE}`);
  console.log(`Dry Run:          ${DRY_RUN ? 'YES' : 'NO'}`);
  console.log('========================================\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Read and process CSV in batches
  const batch = [];
  let isPaused = false;

  const stream = fs.createReadStream(csvPath).pipe(csv());

  await new Promise((resolve, reject) => {
    stream
      .on('data', async (row) => {
        batch.push(row);

        if (batch.length >= BATCH_SIZE) {
          // Pause the stream while we process the batch
          stream.pause();
          isPaused = true;

          const batchToProcess = batch.splice(0, BATCH_SIZE);
          try {
            await processBatch(batchToProcess);
          } catch (error) {
            reject(error);
            return;
          }

          // Resume the stream
          stream.resume();
          isPaused = false;
        }
      })
      .on('end', async () => {
        // Process remaining rows
        if (batch.length > 0) {
          try {
            await processBatch(batch);
          } catch (error) {
            reject(error);
            return;
          }
        }
        resolve();
      })
      .on('error', reject);
  });

  // Print final statistics
  printStats();

  await database.disconnect();

  if (!DRY_RUN) {
    console.log('✓ Import complete!');
  } else {
    console.log('✓ Dry run complete! Run without --dry-run to import data.');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
