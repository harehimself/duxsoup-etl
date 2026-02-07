/**
 * CSV Enrichment Import Script
 *
 * Imports historical DuxSoup visit data from CSV to enrich existing Person records.
 *
 * Features:
 * - Dry-run mode (default) - preview changes without writing to DB
 * - Identity matching via Sales Navigator ID
 * - Selective enrichment - only updates missing/incomplete data
 * - Precedence rules - newer data beats older data
 * - Detailed reporting and statistics
 *
 * Usage:
 *   node scripts/importCsvEnrichment.js --file "path/to/file.csv" --dry-run
 *   node scripts/importCsvEnrichment.js --file "path/to/file.csv" --limit 100
 *   node scripts/importCsvEnrichment.js --file "path/to/file.csv" --execute
 *   node scripts/importCsvEnrichment.js --file "path/to/file.csv" --concurrency 20
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Person = require('../src/models/person');
const { parseLocation } = require('../src/utils/location-parser');
const { parseSafeDate } = require('../src/utils/date-parser');
const logger = require('../src/utils/logger');
const database = require('../src/utils/database');
const identityMatcher = require('../src/utils/identityMatcher');
const identityResolverService = require('../src/services/identityResolverService');
const { computeDerivedMetrics } = require('../src/controllers/personController');
const { parseTitle } = require('../src/utils/titleParser');

// Statistics tracking
const stats = {
  totalRows: 0,
  processed: 0,
  skipped: 0,
  matched: 0,
  created: 0,
  enriched: 0,
  errors: 0,
  fieldsEnriched: {
    skills: 0,
    roles: 0,
    education: 0,
    email: 0,
    phone: 0,
    twitter: 0,
    location: 0,
    summary: 0,
    personalWebsite: 0,
    companyWebsite: 0,
  },
  startTime: null,
  endTime: null,
};

// Track current CSV file name for provenance metadata
let currentCsvFileName = null;

/**
 * Extract Sales Navigator ID from SalesProfile URL
 */
function extractSalesNavId(salesProfileUrl) {
  if (!salesProfileUrl || typeof salesProfileUrl !== 'string') return null;

  // Pattern: https://www.linkedin.com/sales/people/ACoAAACU3sMBTjIb1jDvcDxI0oTFkKSTULI5V00,name,fjDE
  const match = salesProfileUrl.match(/\/sales\/people\/([^,]+)/);
  return match ? match[1] : null;
}

/**
 * Parse skills from CSV columns (Skill-0 through Skill-19)
 */
function parseSkills(row) {
  const skills = [];
  for (let i = 0; i < 20; i++) {
    const skill = row[`Skill-${i}`];
    if (skill && skill.trim()) {
      skills.push(skill.trim());
    }
  }
  return skills;
}

/**
 * Parse positions from CSV columns (Position-0-* through Position-35-*)
 */
function parsePositions(row) {
  const positions = [];
  for (let i = 0; i < 36; i++) {
    const company = row[`Position-${i}-Company`];
    const title = row[`Position-${i}-Title`];

    // Skip if no company or title
    if (!company || !title) continue;

    positions.push({
      Company: company,
      Title: title,
      Location: row[`Position-${i}-Location`] || null,
      Description: row[`Position-${i}-Description`] || null,
      From: row[`Position-${i}-From`] || null,
      To: row[`Position-${i}-To`] || null,
    });
  }
  return positions;
}

/**
 * Parse education from CSV columns (School-0-* through School-19-*)
 */
function parseEducation(row) {
  const schools = [];
  for (let i = 0; i < 20; i++) {
    const name = row[`School-${i}-Name`];

    // Skip if no school name
    if (!name || !name.trim()) continue;

    schools.push({
      Name: name,
      Degree: row[`School-${i}-Degree`] || null,
      Field: row[`School-${i}-Field`] || null,
      From: row[`School-${i}-From`] || null,
      To: row[`School-${i}-To`] || null,
    });
  }
  return schools;
}

/**
 * Transform CSV row to structured data matching our schema
 */
function transformCsvRow(row) {
  const salesNavId = extractSalesNavId(row.SalesProfile);

  return {
    // Identity
    salesNavId,
    profileUrl: row.Profile,

    // Basic info
    firstName: row['First Name'],
    middleName: row['Middle Name'],
    lastName: row['Last Name'],

    // Current position
    currentTitle: row.Title,
    currentCompany: row.Company,

    // Contact
    location: row.Location,
    industry: row.Industry,
    connections: row.Connections,
    summary: row.Summary,
    email: row.Email,
    phone: row.Phone,
    twitter: row.Twitter,
    degree: row.Degree,

    // Profile images
    profilePicture: row.Picture,

    // Websites
    personalWebsite: row.PersonalWebsite,
    companyWebsite: row.CompanyWebsite,
    companyProfile: row.CompanyProfile,

    // Rich data
    skills: parseSkills(row),
    positions: parsePositions(row),
    education: parseEducation(row),

    // Metadata
    visitTime: parseSafeDate(row.VisitTime),
    csvRowId: row.id,
  };
}

/**
 * Convert CSV positions to role schema format
 */
function positionsToRoles(positions) {
  return positions.map(pos => ({
    title: pos.Title,
    companyName: pos.Company,
    location: pos.Location,
    description: pos.Description,
    startDate: parseSafeDate(pos.From),
    endDate: pos.To && pos.To !== 'Present' ? parseSafeDate(pos.To) : null,
    isCurrent: !pos.To || pos.To === 'Present',
    companyId: null, // Will be resolved separately if needed
  }));
}

/**
 * Convert CSV education to schema format
 */
function educationToSchema(education) {
  return education.map(edu => ({
    school: edu.Name,
    degree: edu.Degree,
    field: edu.Field,
    startDate: parseSafeDate(edu.From),
    endDate: parseSafeDate(edu.To),
  }));
}

/**
 * Check if a value should be used for enrichment
 * @returns true if csvValue should enrich dbValue
 */
function shouldEnrich(dbValue, csvValue, dbLastObserved, csvVisitTime) {
  // Don't enrich with empty/null CSV values
  if (!csvValue || (typeof csvValue === 'string' && csvValue.trim() === '')) {
    return false;
  }

  // If DB has no value, always enrich
  if (!dbValue || (typeof dbValue === 'string' && dbValue.trim() === '')) {
    return true;
  }

  // If CSV data is newer, prefer it
  if (csvVisitTime && dbLastObserved && csvVisitTime > dbLastObserved) {
    return true;
  }

  // Default: don't overwrite existing data
  return false;
}

/**
 * Enrich person record with CSV data
 * @param {Object} person - Existing Person document
 * @param {Object} csvData - Transformed CSV row data
 * @param {boolean} dryRun - If true, don't save to DB
 * @returns {Object} { updated: boolean, fieldsEnriched: [] }
 */
async function enrichPerson(person, csvData, dryRun = true) {
  const fieldsEnriched = [];
  const dbLastObserved = person.meta?.lastObservedAt;
  const csvVisitTime = csvData.visitTime;

  // Enrich simple fields
  const simpleFields = [
    { csv: 'email', db: 'email' },
    { csv: 'phone', db: 'phone' },
    { csv: 'twitter', db: 'twitter' },
    { csv: 'location', db: 'location' },
    { csv: 'summary', db: 'summary' },
    { csv: 'personalWebsite', db: 'personalWebsite' },
    { csv: 'companyWebsite', db: 'companyWebsite' },
  ];

  simpleFields.forEach(({ csv, db }) => {
    if (shouldEnrich(person.snapshot[db], csvData[csv], dbLastObserved, csvVisitTime)) {
      person.snapshot[db] = csvData[csv];
      fieldsEnriched.push(db);
      stats.fieldsEnriched[db]++;
    }
  });

  // Enrich location structured fields
  if (fieldsEnriched.includes('location') && csvData.location) {
    const parsedLocation = parseLocation(csvData.location);
    person.snapshot.city = parsedLocation.city;
    person.snapshot.state = parsedLocation.state;
    person.snapshot.stateCode = parsedLocation.stateCode;
    person.snapshot.country = parsedLocation.country;
    person.snapshot.countryCode = parsedLocation.countryCode;
    person.snapshot.province = parsedLocation.province;
    person.snapshot.region = parsedLocation.region;
    person.snapshot.locationType = parsedLocation.locationType;
  }

  // Enrich skills (additive - merge with existing)
  if (csvData.skills.length > 0) {
    if (!person.snapshot.skills || person.snapshot.skills.length === 0) {
      person.snapshot.skills = csvData.skills;
      fieldsEnriched.push('skills');
      stats.fieldsEnriched.skills++;
    } else {
      // Merge: add new skills not already present
      const existingSkills = new Set(person.snapshot.skills);
      const newSkills = csvData.skills.filter(s => !existingSkills.has(s));
      if (newSkills.length > 0) {
        person.snapshot.skills.push(...newSkills);
        fieldsEnriched.push('skills');
        stats.fieldsEnriched.skills++;
      }
    }
  }

  // Enrich roles (additive - add positions not already present)
  if (csvData.positions.length > 0) {
    const csvRoles = positionsToRoles(csvData.positions);
    if (!person.snapshot.roles || person.snapshot.roles.length === 0) {
      person.snapshot.roles = csvRoles;
      fieldsEnriched.push('roles');
      stats.fieldsEnriched.roles++;
    } else {
      // Merge: add roles not already present (match by title + company + startDate)
      const existingRoleKeys = new Set(
        person.snapshot.roles.map(r => `${r.title}|${r.companyName}|${r.startDate}`)
      );
      const newRoles = csvRoles.filter(r => {
        const key = `${r.title}|${r.companyName}|${r.startDate}`;
        return !existingRoleKeys.has(key);
      });
      if (newRoles.length > 0) {
        person.snapshot.roles.push(...newRoles);
        fieldsEnriched.push('roles');
        stats.fieldsEnriched.roles++;
      }
    }
  }

  // Enrich education (additive - add schools not already present)
  if (csvData.education.length > 0) {
    const csvEducation = educationToSchema(csvData.education);
    if (!person.snapshot.education || person.snapshot.education.length === 0) {
      person.snapshot.education = csvEducation;
      fieldsEnriched.push('education');
      stats.fieldsEnriched.education++;
    } else {
      // Merge: add schools not already present (match by school + degree + field)
      const existingEduKeys = new Set(
        person.snapshot.education.map(e => `${e.school}|${e.degree}|${e.field}`)
      );
      const newEducation = csvEducation.filter(e => {
        const key = `${e.school}|${e.degree}|${e.field}`;
        return !existingEduKeys.has(key);
      });
      if (newEducation.length > 0) {
        person.snapshot.education.push(...newEducation);
        fieldsEnriched.push('education');
        stats.fieldsEnriched.education++;
      }
    }
  }

  // Add enrichment metadata
  if (fieldsEnriched.length > 0) {
    person.snapshot._enrichment = {
      csvImportDate: new Date(),
      csvFileName: currentCsvFileName || 'unknown',
      fieldsEnriched,
      csvVisitTime: csvVisitTime,
      csvRowId: csvData.csvRowId,
    };

    // Save if not dry-run
    if (!dryRun) {
      await person.save();
    }

    return { updated: true, fieldsEnriched };
  }

  return { updated: false, fieldsEnriched: [] };
}

/**
 * Parse connections string to number
 * Handles: "500", "1234", "500+" (strips +)
 */
function parseConnections(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (str === '') return null;
  const num = parseInt(str.replace(/\+$/, ''), 10);
  return isNaN(num) || num < 0 ? null : num;
}

/**
 * Parse degree string to number (1-3)
 * Handles: "1", "2", "3", "1st", "2nd", "3rd"
 */
function parseDegree(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim().toLowerCase();
  if (str === '') return null;
  const match = str.match(/^(\d+)(st|nd|rd|th)?$/);
  if (match) {
    const num = parseInt(match[1], 10);
    return num >= 1 && num <= 3 ? num : null;
  }
  return null;
}

/**
 * Create a new Person record from a CSV row.
 * Uses identityResolverService to handle dedup and race conditions.
 *
 * @param {Object} row - Raw CSV row
 * @param {Object} csvData - Transformed CSV data from transformCsvRow()
 * @param {Object} identifiers - Extracted identifiers from identityMatcher
 * @param {boolean} dryRun - If true, skip DB writes
 * @returns {Object} { created, enriched, error, person_id }
 */
async function createPersonFromCsv(row, csvData, identifiers, dryRun) {
  // Build webhook-shaped data for resolvePersonIdentity
  const webhookShaped = {
    Profile: csvData.profileUrl,
    SalesProfile: row.SalesProfile,
    PublicProfile: row.PublicProfile,
    RecruiterProfile: row.RecruiterProfile,
    id: csvData.csvRowId,
  };

  const identity = identityMatcher.resolvePersonIdentity(webhookShaped);

  if (!identity.person_id) {
    logger.warn('Cannot create person from CSV: no stable identity', {
      csvRowId: csvData.csvRowId,
      profileUrl: csvData.profileUrl,
    });
    return { created: false, error: 'no_stable_identity' };
  }

  if (dryRun) {
    return { created: true, person_id: identity.person_id };
  }

  // Resolve or create via the identity service (handles dedup, race conditions)
  let person;
  try {
    person = await identityResolverService.resolveOrCreate(identity);
  } catch (err) {
    logger.error('Failed to resolve/create person from CSV', {
      person_id: identity.person_id,
      error: err.message,
    });
    return { created: false, error: err.message };
  }

  // If the person already has a populated snapshot (race condition or
  // created between our lookup and now), fall back to enrichPerson()
  if (person.snapshot && person.snapshot.firstName) {
    const enrichResult = await enrichPerson(person, csvData, false);
    return { created: false, enriched: true, person_id: person._id, fieldsEnriched: enrichResult.fieldsEnriched };
  }

  // Populate snapshot fields with _meta provenance
  const now = csvData.visitTime || new Date();
  const observationMeta = {
    observedAt: now,
    source: 'csv',
    observationId: null,
  };

  if (!person.snapshot) {
    person.snapshot = {};
  }
  if (!person.snapshot._meta) {
    person.snapshot._meta = {};
  }

  // Helper: set field value and record provenance
  const setField = (fieldName, value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' && value.trim() === '') return;
    person.snapshot[fieldName] = value;
    person.snapshot._meta[fieldName] = {
      value,
      observedAt: observationMeta.observedAt,
      source: observationMeta.source,
      observationId: observationMeta.observationId,
    };
  };

  // Basic info
  setField('firstName', csvData.firstName);
  setField('middleName', csvData.middleName);
  setField('lastName', csvData.lastName);

  // Compute fullName
  const fullName = [csvData.firstName, csvData.middleName, csvData.lastName]
    .filter(Boolean)
    .join(' ');
  if (fullName) {
    setField('fullName', fullName);
  }

  // Current position
  setField('currentTitle', csvData.currentTitle);
  setField('currentCompany', csvData.currentCompany);

  // Parse title for seniority + department
  if (csvData.currentTitle) {
    const parsed = parseTitle(csvData.currentTitle);
    if (parsed.seniority) setField('parsedSeniority', parsed.seniority);
    if (parsed.department) setField('parsedDepartment', parsed.department);
  }

  // Location
  setField('location', csvData.location);
  if (csvData.location) {
    const parsedLocation = parseLocation(csvData.location);
    setField('city', parsedLocation.city);
    setField('state', parsedLocation.state);
    setField('stateCode', parsedLocation.stateCode);
    setField('country', parsedLocation.country);
    setField('countryCode', parsedLocation.countryCode);
    setField('province', parsedLocation.province);
    setField('region', parsedLocation.region);
    setField('locationType', parsedLocation.locationType);
  }

  // Contact & profile
  setField('email', csvData.email);
  setField('phone', csvData.phone);
  setField('twitter', csvData.twitter);
  setField('summary', csvData.summary);
  setField('profilePicture', csvData.profilePicture);
  setField('personalWebsite', csvData.personalWebsite);
  setField('companyWebsite', csvData.companyWebsite);
  setField('connections', parseConnections(csvData.connections));
  setField('degree', parseDegree(csvData.degree));

  // Roles with seniority enrichment
  if (csvData.positions.length > 0) {
    person.snapshot.roles = positionsToRoles(csvData.positions).map(role => {
      if (role.title) {
        const parsed = parseTitle(role.title);
        role.seniority = parsed.seniority;
        role.seniorityRank = parsed.seniorityRank;
      }
      return role;
    });
  }

  // Education
  if (csvData.education.length > 0) {
    person.snapshot.education = educationToSchema(csvData.education);
  }

  // Skills
  if (csvData.skills.length > 0) {
    person.snapshot.skills = csvData.skills;
  }

  // Enrichment metadata
  person.snapshot._enrichment = {
    csvImportDate: new Date(),
    csvFileName: currentCsvFileName,
    createdFromCsv: true,
    csvVisitTime: csvData.visitTime,
    csvRowId: csvData.csvRowId,
  };

  // Person-level metadata
  person.meta = {
    lastObservedAt: now,
    lastObservation: null,
    observationsCount: 0,
  };

  // Derived metrics
  person.derived = computeDerivedMetrics(person.snapshot.roles || []);

  // Save with E11000 duplicate key fallback
  try {
    await person.save();
  } catch (err) {
    if (err.code === 11000) {
      // Race condition: another process created this person between our resolve and save
      logger.info('E11000 on person create from CSV, falling back to enrich', {
        person_id: person._id,
      });
      const existing = await Person.findById(person._id);
      if (existing) {
        const enrichResult = await enrichPerson(existing, csvData, false);
        return { created: false, enriched: true, person_id: existing._id, fieldsEnriched: enrichResult.fieldsEnriched };
      }
      return { created: false, error: 'duplicate_key_and_not_found' };
    }
    throw err;
  }

  return { created: true, person_id: person._id };
}

/**
 * Process a single CSV row
 */
async function processRow(row, dryRun = true) {
  try {
    const csvData = transformCsvRow(row);

    // Skip if no Sales Navigator ID
    if (!csvData.salesNavId) {
      logger.warn('Skipping row: no Sales Navigator ID', {
        csvRowId: csvData.csvRowId,
        profileUrl: csvData.profileUrl,
      });
      stats.skipped++;
      return;
    }

    // Use the same identity waterfall as the rest of the system
    // Extract all identifiers from CSV data
    const identifiers = identityMatcher.extractIdentifiers({
      Profile: csvData.profileUrl,
      SalesProfile: row.SalesProfile,
      PublicProfile: row.PublicProfile,
      RecruiterProfile: row.RecruiterProfile,
      id: csvData.csvRowId,
    });

    // Try to find person by any identifier in priority order
    let person = null;

    // 1. Try LinkedIn Username (highest priority)
    if (identifiers.linkedInUsername && !person) {
      person = await Person.findOne({
        'aliases.type': 'linkedInUsername',
        'aliases.value': identifiers.linkedInUsername,
      });
    }

    // 2. Try Sales Navigator ID
    if (identifiers.salesNavId && !person) {
      person = await Person.findOne({
        'aliases.type': 'salesNavId',
        'aliases.value': identifiers.salesNavId,
      });
    }

    // 3. Try normalized profile URL
    if (identifiers.profileUrl && !person) {
      person = await Person.findOne({
        'aliases.type': 'profileUrl',
        'aliases.value': identifiers.profileUrl,
      });
    }

    // 4. Try public profile
    if (identifiers.publicProfile && !person) {
      person = await Person.findOne({
        'aliases.type': 'publicProfile',
        'aliases.value': identifiers.publicProfile,
      });
    }

    // 5. Try recruiter profile
    if (identifiers.recruiterProfile && !person) {
      person = await Person.findOne({
        'aliases.type': 'recruiterProfile',
        'aliases.value': identifiers.recruiterProfile,
      });
    }

    // Debug: Log matching details for first few records
    if (!person && stats.processed < 5) {
      logger.info('Debug: No match found with waterfall', {
        csvRowId: csvData.csvRowId,
        identifiers,
      });
    }

    if (person) {
      // Match found - enrich existing record
      stats.matched++;
      const result = await enrichPerson(person, csvData, dryRun);

      if (result.updated) {
        stats.enriched++;
        logger.info('Enriched person from CSV', {
          person_id: person._id,
          fieldsEnriched: result.fieldsEnriched,
          dryRun,
        });
      }
    } else {
      // No match - create new person record
      const result = await createPersonFromCsv(row, csvData, identifiers, dryRun);

      if (result.created) {
        stats.created++;
        logger.info('Created new person from CSV', {
          person_id: result.person_id,
          name: `${csvData.firstName} ${csvData.lastName}`,
          dryRun,
        });
      } else if (result.enriched) {
        stats.enriched++;
        logger.info('Enriched existing person from CSV (race fallback)', {
          person_id: result.person_id,
          fieldsEnriched: result.fieldsEnriched,
        });
      } else if (result.error) {
        stats.errors++;
        logger.warn('Failed to create person from CSV', {
          error: result.error,
          salesNavId: csvData.salesNavId,
          name: `${csvData.firstName} ${csvData.lastName}`,
        });
      }
    }

    stats.processed++;

    // Progress update every 50 records
    if (stats.processed % 50 === 0) {
      logger.info('Import progress', {
        processed: stats.processed,
        matched: stats.matched,
        enriched: stats.enriched,
        created: stats.created,
        skipped: stats.skipped,
      });
    }
  } catch (error) {
    stats.errors++;
    logger.error('Error processing CSV row', {
      csvRowId: row.id,
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Process items with limited concurrency using a worker-pool pattern.
 * Spawns up to `concurrency` workers that pull from a shared queue.
 * Safe in Node.js single-threaded model — index increment is atomic.
 *
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to call for each item
 * @param {number} concurrency - Max concurrent operations
 */
async function processWithConcurrency(items, fn, concurrency) {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/**
 * Generate final report
 */
function generateReport() {
  const duration = stats.endTime - stats.startTime;
  const durationSec = Math.round(duration / 1000);

  console.log('\n========================================');
  console.log('CSV ENRICHMENT IMPORT REPORT');
  console.log('========================================\n');

  console.log('Summary:');
  console.log(`  Total rows: ${stats.totalRows}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Matched existing: ${stats.matched}`);
  console.log(`  Enriched: ${stats.enriched}`);
  console.log(`  New records: ${stats.created}`);
  console.log(`  Skipped: ${stats.skipped}`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Duration: ${durationSec}s\n`);

  console.log('Fields Enriched:');
  Object.entries(stats.fieldsEnriched).forEach(([field, count]) => {
    if (count > 0) {
      console.log(`  ${field}: ${count}`);
    }
  });

  console.log('\n========================================\n');
}

/**
 * Main import function
 */
async function importCsv(filePath, options = {}) {
  const { dryRun = true, limit = null, concurrency = 10 } = options;

  stats.startTime = new Date();
  currentCsvFileName = path.basename(filePath);

  console.log('\n========================================');
  console.log('CSV ENRICHMENT IMPORT');
  console.log('========================================\n');
  console.log(`File: ${filePath}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'EXECUTE (writing to DB)'}`);
  console.log(`Limit: ${limit || 'none'}`);
  console.log(`Concurrency: ${concurrency}\n`);

  // Connect to MongoDB using the existing database utility
  await database.connect();

  // Count total rows
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  stats.totalRows = fileContent.split('\n').length - 1; // -1 for header

  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rows.push(row);
      })
      .on('end', async () => {
        try {
          // Apply limit if specified
          const rowsToProcess = limit ? rows.slice(0, limit) : rows;

          // Process rows with limited concurrency
          await processWithConcurrency(
            rowsToProcess,
            (row) => processRow(row, dryRun),
            concurrency
          );

          stats.endTime = new Date();
          generateReport();

          await database.disconnect();
          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', reject);
  });
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: !args.includes('--execute'),
    limit: null,
    concurrency: 10,
    filePath: null,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      options.filePath = args[i + 1];
    }
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--concurrency' && args[i + 1]) {
      options.concurrency = parseInt(args[i + 1], 10);
    }
  }

  // Default file path
  if (!options.filePath) {
    options.filePath = 'dux-soup-visit-data@2025-01-17 12h13.csv';
  }

  importCsv(options.filePath, options)
    .then(() => {
      console.log('Import completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}

module.exports = { importCsv, transformCsvRow, enrichPerson, createPersonFromCsv, positionsToRoles, educationToSchema, parseConnections, parseDegree, processWithConcurrency };
