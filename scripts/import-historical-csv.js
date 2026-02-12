const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Visit = require('../src/models/visit');
const Person = require('../src/models/person');
const { parseLocation } = require('../src/utils/location-parser');
const { parseSafeDate, parseLinkedInDate } = require('../src/utils/date-parser');
const { computeCanonicalId } = require('../src/utils/identityMatcher');
const identityResolver = require('../src/services/identityResolverService');
const logger = require('../src/utils/logger');

/**
 * Import Historical CSV - Specialized Script for historical-extraction.csv
 *
 * This script handles the specific format of the historical DuxSoup export:
 * - ID format: "id.XXXXXXX" (different from current duxsoupId)
 * - Missing salesNavId for all rows
 * - Extended position history (Position-0 through Position-25)
 * - School data (School-0 through School-19)
 * - Synthetic event_key generation with fixed userid
 *
 * Usage:
 *   node scripts/import-historical-csv.js <csv-file-path> [--dry-run] [--batch-size=100]
 *
 * Example:
 *   node scripts/import-historical-csv.js historical-extraction.csv --dry-run
 *   node scripts/import-historical-csv.js historical-extraction.csv --batch-size=50
 */

const BATCH_SIZE = parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 100;
const DRY_RUN = process.argv.includes('--dry-run');
const CSV_FILE = process.argv[2];

// Synthetic userid for event_key generation (enables idempotency)
const SYNTHETIC_USERID = 'historical-import';

// Statistics tracking with extended metrics
const stats = {
  totalRows: 0,
  visitsCreated: 0,
  visitsUpdated: 0,
  visitsFailed: 0,
  peopleCreated: 0,
  peopleUpdated: 0,
  skillsAdded: 0,
  rolesAdded: 0,
  schoolsAdded: 0,
  missingStableId: 0,
  duplicateEventKeys: 0,
  errors: [],
};

/**
 * Generate event_key for idempotency
 * Format: SHA1(userid + type + time + id)
 */
function generateEventKey(userid, type, visitTime, id) {
  if (!userid || !type || !visitTime || !id) {
    return null;
  }
  const data = `${userid}:${type}:${visitTime}:${id}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

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
 * Extract position history from CSV row (Position-0 through Position-25)
 * EXTENDED: Historical CSV has up to Position-49, but analysis shows only
 * 5 records (0.01%) use Position-23+, so Position-25 covers 99.99%+ of data.
 */
function extractPositions(row) {
  const positions = [];
  for (let i = 0; i <= 25; i++) {
    const company = row[`Position-${i}-Company`];
    const title = row[`Position-${i}-Title`];
    const description = row[`Position-${i}-Description`];
    const from = row[`Position-${i}-From`];
    const to = row[`Position-${i}-To`];
    const location = row[`Position-${i}-Location`];
    const industry = row[`Position-${i}-Industry`];
    const companySize = row[`Position-${i}-CompanySize`];

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
        industry: industry?.trim() || null,
        companySize: companySize?.trim() || null,
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
 * Extract education history from CSV row (School-0 through School-19)
 * NEW: Historical CSV includes education data not in current imports
 */
function extractSchools(row) {
  const schools = [];
  for (let i = 0; i <= 19; i++) {
    const name = row[`School-${i}-Name`];
    const degree = row[`School-${i}-Degree`];
    const field = row[`School-${i}-Field`];
    const from = row[`School-${i}-From`];
    const to = row[`School-${i}-To`];

    // Only add if school name exists
    if (name && name.trim()) {
      const school = {
        name: name.trim(),
        degree: degree?.trim() || null,
        field: field?.trim() || null,
        from: from?.trim() || null,
        to: to?.trim() || null,
        startDate: parseLinkedInDate(from),
        endDate: parseLinkedInDate(to),
      };
      schools.push(school);
    }
  }
  return schools;
}

/**
 * Build aliases array from CSV row
 * MODIFIED: Historical CSV has empty salesNavId for ALL rows
 */
function buildAliases(row) {
  const aliases = [];

  // Handle BOM in CSV - id column might be "﻿id" or "id"
  const rowId = row.id || row['﻿id'];

  // Sales Navigator ID (will be empty for historical CSV)
  if (row.salesNavId && row.salesNavId.trim()) {
    aliases.push({ type: 'salesNavId', value: row.salesNavId.trim() });
  }

  // DuxSoup ID - use from 'id' column (format: "id.XXXXXXX")
  if (rowId && rowId.trim()) {
    const duxsoupId = rowId.trim();
    aliases.push({ type: 'duxsoupId', value: duxsoupId });
  }

  // Profile URLs - check for non-empty values
  if (row.Profile && row.Profile.trim()) {
    aliases.push({ type: 'profileUrl', value: row.Profile.trim() });
    // Extract username from profile URL
    const usernameMatch = row.Profile.match(/linkedin\.com\/in\/([^/?]+)/);
    if (usernameMatch && usernameMatch[1]) {
      aliases.push({ type: 'linkedInUsername', value: usernameMatch[1] });
    }
  }

  if (row.SalesProfile && row.SalesProfile.trim()) {
    aliases.push({ type: 'salesUrl', value: row.SalesProfile.trim() });
  }

  if (row.RecruiterProfile && row.RecruiterProfile.trim()) {
    aliases.push({ type: 'recruiterUrl', value: row.RecruiterProfile.trim() });
  }

  // Filter out any aliases with empty values (extra safety)
  return aliases.filter(alias => alias.value && alias.value.trim());
}

/**
 * Create or update Visit observation
 * MODIFIED: Uses row.id instead of row.duxsoupId, generates synthetic event_key
 */
async function processVisit(row) {
  try {
    // Handle BOM in CSV - id column might be "﻿id" or "id"
    const rowId = row.id || row['﻿id'];

    const visitTime = parseSafeDate(row.VisitTime);
    const eventKey = generateEventKey(SYNTHETIC_USERID, 'visit', visitTime, rowId);

    const visitData = {
      id: rowId, // Already in format "id.XXXXXXX"
      userid: SYNTHETIC_USERID, // Synthetic userid for historical imports
      VisitTime: visitTime,
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
      event_key: eventKey, // Add event_key for idempotency
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

    // Store skills, positions, and schools in extended field
    const skills = extractSkills(row);
    const positions = extractPositions(row);
    const schools = extractSchools(row);

    visitData.extended = {
      skills,
      positions,
      schools, // NEW: Include education data
    };

    // Store full raw CSV data
    visitData.rawData = { ...row };

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would create visit: ${visitData.id}`);
      stats.visitsCreated++;
      return visitData;
    }

    // Use findOneAndUpdate with upsert for idempotency
    // If event_key exists, returns existing record without update
    const visit = await Visit.findOneAndUpdate(
      { event_key: eventKey },
      { $setOnInsert: visitData },
      { upsert: true, new: true }
    );

    // Check if this was a new insert or existing record
    if (visit.id === visitData.id && visit.VisitTime.getTime() === visitData.VisitTime.getTime()) {
      // Could be either new or existing - check if createdAt ~= updatedAt
      const timeDiff = Math.abs(visit.updatedAt - visit.createdAt);
      if (timeDiff < 1000) {
        stats.visitsCreated++;
      } else {
        console.log(`Visit already exists (event_key match): ${visitData.id} - skipping`);
        stats.duplicateEventKeys++;
      }
    }

    return visit;
  } catch (error) {
    const rowId = row.id || row['﻿id'];
    stats.visitsFailed++;
    stats.errors.push({
      row: rowId,
      type: 'visit',
      error: error.message,
    });
    logger.error('Failed to process visit', {
      id: rowId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Create or update Person snapshot with enrichment
 * MODIFIED: Handles missing salesNavId, includes education data
 */
async function processPerson(row, visit) {
  try {
    // Handle BOM in CSV - id column might be "﻿id" or "id"
    const rowId = row.id || row['﻿id'];

    // Build aliases for identity resolution
    const aliases = buildAliases(row);

    if (aliases.length === 0) {
      logger.warn('No aliases found for person', { id: rowId });
      return null;
    }

    // Track missing stable IDs
    const hasSalesNavId = aliases.some(a => a.type === 'salesNavId');
    if (!hasSalesNavId) {
      stats.missingStableId++;
    }

    let person;
    const skills = extractSkills(row);
    const positions = extractPositions(row);
    const schools = extractSchools(row);

    // Parse location
    const parsedLocation = row.Location ? parseLocation(row.Location) : {};

    // In dry-run mode, skip database lookups
    const existingPeople = DRY_RUN ? [] : await identityResolver.findByAnyAlias(aliases);

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
      industry: pos.industry,
      companySize: pos.companySize,
      startDate: pos.startDate,
      endDate: pos.endDate,
      isCurrent: pos.isCurrent,
    }));

    snapshotData.roles = roles;

    // Build education from schools
    const education = schools.map(school => ({
      institution: school.name,
      degree: school.degree,
      fieldOfStudy: school.field,
      from: school.from,
      to: school.to,
      startDate: school.startDate,
      endDate: school.endDate,
    }));

    snapshotData.education = education;

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
      stats.schoolsAdded += schools.length;
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
        } else if (key === 'education') {
          // Merge education (avoid duplicates based on institution + degree + dates)
          const existingEducation = person.snapshot.education || [];
          const newEducation = education.filter(newEdu => {
            return !existingEducation.some(existingEdu =>
              existingEdu.institution === newEdu.institution &&
              existingEdu.degree === newEdu.degree &&
              existingEdu.startDate?.getTime() === newEdu.startDate?.getTime()
            );
          });
          if (newEducation.length > 0) {
            person.snapshot.education = [...existingEducation, ...newEducation];
            stats.schoolsAdded += newEducation.length;
          }
        } else if (snapshotData[key] && !person.snapshot[key]) {
          // Only update if we have new data and field is empty
          person.snapshot[key] = snapshotData[key];
        }
      });

      // Add visit reference (capped to prevent unbounded growth)
      if (visit && !person.observations.visits.includes(visit._id)) {
        person.observations.visits.push(visit._id);
        // Trim to MAX_OBSERVATION_REFS if exceeded
        const { MAX_OBSERVATION_REFS } = require('../src/constants/limits');
        if (person.observations.visits.length > MAX_OBSERVATION_REFS) {
          person.observations.visits = person.observations.visits.slice(-MAX_OBSERVATION_REFS);
        }
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
      // Choose primary ID based on what's valid for Person model
      let personId;
      const salesNavId = aliases.find(a => a.type === 'salesNavId');
      const profileUrl = aliases.find(a => a.type === 'profileUrl');
      const username = aliases.find(a => a.type === 'linkedInUsername');
      const duxsoupId = aliases.find(a => a.type === 'duxsoupId');

      if (salesNavId) {
        // Sales Nav ID (best option)
        personId = salesNavId.value;
      } else if (username) {
        // LinkedIn username from profile URL
        personId = username.value;
      } else if (duxsoupId) {
        // Extract numeric part from "id.XXXXXXX" format
        const numericMatch = duxsoupId.value.match(/^id\.(\d+)$/);
        if (numericMatch && numericMatch[1].length >= 8) {
          // Use numeric ID if it's 8+ digits
          personId = numericMatch[1];
        } else {
          // Fallback to username or profileUrl
          personId = username?.value || profileUrl?.value || duxsoupId.value;
        }
      } else {
        // Use first valid alias
        personId = aliases[0].value;
      }

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
      stats.schoolsAdded += schools.length;
      console.log(`Created person: ${person.snapshot.fullName} (${person._id})`);
    }

    return person;
  } catch (error) {
    const rowId = row.id || row['﻿id'];
    stats.errors.push({
      row: rowId,
      type: 'person',
      error: error.message,
    });
    logger.error('Failed to process person', {
      id: rowId,
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
      await processPerson(row, visit);

      if (stats.totalRows % 50 === 0) {
        console.log(`\nProcessed ${stats.totalRows} rows...`);
        printStats();
      }
    } catch (error) {
      const rowId = row.id || row['﻿id'];
      console.error(`Error processing row ${rowId}:`, error.message);
    }
  }
}

/**
 * Print statistics
 */
function printStats() {
  console.log('\n========================================');
  console.log('HISTORICAL IMPORT STATISTICS');
  console.log('========================================');
  console.log(`Total Rows Processed:     ${stats.totalRows}`);
  console.log(`\nVisits:`);
  console.log(`  Created:                ${stats.visitsCreated}`);
  console.log(`  Skipped (duplicate):    ${stats.duplicateEventKeys}`);
  console.log(`  Failed:                 ${stats.visitsFailed}`);
  console.log(`\nPeople:`);
  console.log(`  Created:                ${stats.peopleCreated}`);
  console.log(`  Updated (enriched):     ${stats.peopleUpdated}`);
  console.log(`  Skills Added:           ${stats.skillsAdded}`);
  console.log(`  Roles Added:            ${stats.rolesAdded}`);
  console.log(`  Education Added:        ${stats.schoolsAdded}`);
  console.log(`\nData Quality:`);
  console.log(`  Missing Sales Nav ID:   ${stats.missingStableId}`);
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
    console.error('Usage: node scripts/import-historical-csv.js <csv-file-path> [--dry-run] [--batch-size=100]');
    process.exit(1);
  }

  const csvPath = path.isAbsolute(CSV_FILE) ? CSV_FILE : path.join(process.cwd(), CSV_FILE);

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  // Only connect to database if not in dry-run mode
  if (!DRY_RUN) {
    await database.connect();
  }

  console.log('\n========================================');
  console.log('HISTORICAL CSV IMPORT');
  console.log('========================================\n');
  console.log(`CSV File:         ${csvPath}`);
  console.log(`Batch Size:       ${BATCH_SIZE}`);
  console.log(`Dry Run:          ${DRY_RUN ? 'YES' : 'NO'}`);
  console.log(`Synthetic UserID: ${SYNTHETIC_USERID}`);
  console.log('========================================\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Read and process CSV in batches
  const batch = [];
  let isProcessing = false;
  const processingQueue = [];

  const stream = fs.createReadStream(csvPath).pipe(csv());

  await new Promise((resolve, reject) => {
    stream
      .on('data', (row) => {
        batch.push(row);

        if (batch.length >= BATCH_SIZE && !isProcessing) {
          // Pause the stream while we process the batch
          stream.pause();
          isProcessing = true;

          const batchToProcess = batch.splice(0, BATCH_SIZE);

          // Process the batch and handle completion
          processBatch(batchToProcess)
            .then(() => {
              isProcessing = false;
              stream.resume();
            })
            .catch((error) => {
              isProcessing = false;
              reject(error);
            });
        }
      })
      .on('end', async () => {
        // Wait for any in-flight processing to complete
        while (isProcessing) {
          await new Promise(r => setTimeout(r, 100));
        }

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

  // Only disconnect if we connected
  if (!DRY_RUN) {
    await database.disconnect();
  }

  if (!DRY_RUN) {
    console.log('✓ Import complete!');
    console.log('\nNext steps:');
    console.log('  1. Review dead_letters collection for failed person upserts');
    console.log('  2. Run: node scripts/replay-dead-letters.js --dry-run');
    console.log('  3. Check data quality with health checks');
  } else {
    console.log('✓ Dry run complete! Run without --dry-run to import data.');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
