#!/usr/bin/env node
/**
 * Comprehensive Snapshot Backfill
 * Recovers ALL missing snapshot data from observations (visits prioritized over scans)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

const isDryRun = process.argv.includes('--dry-run');

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB\n');
}

function extractDataFromVisit(visit) {
  if (!visit) return null;

  return {
    firstName: visit['First Name'] || '',
    middleName: visit['Middle Name'] || '',
    lastName: visit['Last Name'] || '',
    fullName: [visit['First Name'], visit['Middle Name'], visit['Last Name']]
      .filter(Boolean).join(' ').trim(),
    currentTitle: visit.Title || '',
    currentCompany: visit.Company || '',
    currentCompanyId: visit.CompanyProfile ?
      visit.CompanyProfile.match(/\/company\/(\d+)/)?.[1] || '' : '',
    currentCompanyProfile: visit.CompanyProfile || '',
    location: visit.Location || '',
    city: visit.city || '',
    state: visit.state || '',
    stateCode: visit.stateCode || '',
    country: visit.country || '',
    countryCode: visit.countryCode || '',
    industry: visit.Industry || '',
    connections: visit.Connections || '',
    summary: visit.Summary || '',
    email: visit.Email || '',
    phone: visit.Phone || '',
    twitter: visit.Twitter || '',
    profilePicture: visit.Picture || '',
    personalWebsite: visit.PersonalWebsite || '',
    companyWebsite: visit.CompanyWebsite || '',
    degree: visit.Degree || '',
    // Extended data
    positions: visit.extended?.positions || [],
    skills: visit.extended?.skills || [],
    schools: visit.extended?.schools || []
  };
}

function extractDataFromScan(scan) {
  if (!scan) return null;

  return {
    firstName: scan['First Name'] || '',
    middleName: scan['Middle Name'] || '',
    lastName: scan['Last Name'] || '',
    fullName: [scan['First Name'], scan['Middle Name'], scan['Last Name']]
      .filter(Boolean).join(' ').trim(),
    currentTitle: scan.Title || '',
    currentCompany: scan.Company || '',
    currentCompanyId: scan.CompanyID || '',
    location: scan.Location || '',
    city: scan.city || '',
    state: scan.state || '',
    stateCode: scan.stateCode || '',
    country: scan.country || '',
    countryCode: scan.countryCode || '',
    industry: scan.Industry || '',
    connections: scan.Connections || '',
    summary: scan.Summary || '',
    thumbnail: scan.Thumbnail || '',
    // Scans typically don't have extended data
    positions: scan.positions || [],
    skills: scan.skills || [],
    schools: scan.schools || []
  };
}

function buildSnapshotUpdate(person, extractedData, source, observationId) {
  const update = { $set: {} };
  let fieldsUpdated = 0;

  // Helper to safely update field if it's missing in snapshot
  const updateField = (field, value) => {
    if (!value || value === '') return;

    const currentValue = person.snapshot?.[field];
    if (!currentValue || currentValue === '' || currentValue === null) {
      update.$set[`snapshot.${field}`] = value;

      // Add to _meta for provenance tracking
      update.$set[`snapshot._meta.${field}`] = {
        value: value,
        observedAt: Date.now(),
        source: source,
        observationId: observationId
      };

      fieldsUpdated++;
    }
  };

  // Update all basic fields
  updateField('firstName', extractedData.firstName);
  updateField('middleName', extractedData.middleName);
  updateField('lastName', extractedData.lastName);
  updateField('fullName', extractedData.fullName);
  updateField('currentTitle', extractedData.currentTitle);
  updateField('currentCompany', extractedData.currentCompany);
  updateField('currentCompanyId', extractedData.currentCompanyId);
  updateField('location', extractedData.location);
  updateField('city', extractedData.city);
  updateField('state', extractedData.state);
  updateField('stateCode', extractedData.stateCode);
  updateField('country', extractedData.country);
  updateField('countryCode', extractedData.countryCode);
  updateField('industry', extractedData.industry);
  updateField('connections', extractedData.connections);
  updateField('summary', extractedData.summary);
  updateField('email', extractedData.email);
  updateField('phone', extractedData.phone);
  updateField('twitter', extractedData.twitter);
  updateField('profilePicture', extractedData.profilePicture);
  updateField('thumbnail', extractedData.thumbnail);
  updateField('personalWebsite', extractedData.personalWebsite);
  updateField('companyWebsite', extractedData.companyWebsite);
  updateField('degree', extractedData.degree);

  // Handle roles from positions (only if snapshot.roles is empty)
  if (extractedData.positions?.length > 0 &&
      (!person.snapshot?.roles || person.snapshot.roles.length === 0)) {
    const roles = extractedData.positions.slice(0, 10).map(pos => ({
      title: pos.Title || '',
      companyName: pos.Company || '',
      location: pos.Location || '',
      description: pos.Description || '',
      startDate: parseDate(pos.From),
      endDate: pos.To === 'Present' ? null : parseDate(pos.To),
      isCurrent: pos.To === 'Present'
    }));

    if (roles.length > 0) {
      update.$set['snapshot.roles'] = roles;
      fieldsUpdated++;
    }
  }

  // Handle education from schools (only if snapshot.education is empty)
  if (extractedData.schools?.length > 0 &&
      (!person.snapshot?.education || person.snapshot.education.length === 0)) {
    const education = extractedData.schools.map(school => ({
      school: school.Name || '',
      degree: school.Degree || '',
      field: school.Field || '',
      startDate: parseDate(school.From),
      endDate: parseDate(school.To)
    }));

    if (education.length > 0) {
      update.$set['snapshot.education'] = education;
      fieldsUpdated++;
    }
  }

  // Handle skills (only if snapshot.skills is empty)
  if (extractedData.skills?.length > 0 &&
      (!person.snapshot?.skills || person.snapshot.skills.length === 0)) {
    update.$set['snapshot.skills'] = extractedData.skills;
    fieldsUpdated++;
  }

  return { update, fieldsUpdated };
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === '') return null;

  // Handle "MMM YYYY" format
  const match = dateStr.match(/([A-Za-z]+)\s+(\d{4})/);
  if (match) {
    const months = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    const month = months[match[1]];
    const year = parseInt(match[2]);
    if (month !== undefined) {
      return new Date(year, month, 1);
    }
  }

  // Handle YYYY format
  const yearMatch = dateStr.match(/^(\d{4})$/);
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0, 1);
  }

  return null;
}

async function backfillAllData() {
  console.log('━'.repeat(70));
  console.log(`  COMPREHENSIVE SNAPSHOT BACKFILL ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be saved\n');
  }

  // Find people with missing critical data
  const peopleNeedingBackfill = await Person.find({
    $or: [
      { 'snapshot.fullName': { $in: [null, ''] } },
      { 'snapshot.currentTitle': { $in: [null, ''] } },
      { 'snapshot.currentCompany': { $in: [null, ''] } },
      { 'snapshot.industry': { $in: [null, ''] } },
      { 'snapshot.connections': { $in: [null, ''] } }
    ]
  }).lean();

  console.log(`Found ${peopleNeedingBackfill.length} people needing backfill\n`);

  const stats = {
    total: peopleNeedingBackfill.length,
    recovered: 0,
    noObservations: 0,
    failed: 0,
    totalFieldsRecovered: 0
  };

  const updates = [];

  for (const person of peopleNeedingBackfill) {
    let extractedData = null;
    let source = null;
    let observationId = null;

    // Prioritize visits (richer data)
    if (person.observations?.visits?.length > 0) {
      const visitId = person.observations.visits[0];
      const visit = await Visit.findById(visitId).lean();

      if (visit) {
        extractedData = extractDataFromVisit(visit);
        source = 'visit';
        observationId = visitId;
      }
    }

    // Fallback to scans if no visit data
    if (!extractedData && person.observations?.scans?.length > 0) {
      const scanId = person.observations.scans[0];
      const scan = await Scan.findById(scanId).lean();

      if (scan) {
        extractedData = extractDataFromScan(scan);
        source = 'scan';
        observationId = scanId;
      }
    }

    if (extractedData) {
      const { update, fieldsUpdated } = buildSnapshotUpdate(
        person,
        extractedData,
        source,
        observationId
      );

      if (fieldsUpdated > 0) {
        updates.push({
          personId: person._id,
          canonicalId: person.canonical_id,
          fieldsUpdated,
          update
        });

        stats.recovered++;
        stats.totalFieldsRecovered += fieldsUpdated;
      }
    } else if (!person.observations?.visits?.length && !person.observations?.scans?.length) {
      stats.noObservations++;
    } else {
      stats.failed++;
    }

    if (stats.recovered % 100 === 0 && stats.recovered > 0) {
      console.log(`Progress: ${stats.recovered}/${peopleNeedingBackfill.length}...`);
    }
  }

  console.log('\n' + '━'.repeat(70));
  console.log('BACKFILL SUMMARY:');
  console.log('━'.repeat(70));
  console.log(`Total people analyzed: ${stats.total}`);
  console.log(`Recoverable: ${stats.recovered}`);
  console.log(`Total fields recovered: ${stats.totalFieldsRecovered}`);
  console.log(`Average fields per person: ${(stats.totalFieldsRecovered / (stats.recovered || 1)).toFixed(1)}`);
  console.log(`No observations: ${stats.noObservations}`);
  console.log(`Failed: ${stats.failed}`);
  console.log('━'.repeat(70) + '\n');

  if (isDryRun) {
    console.log('✓ Dry run complete. No changes made.');
    console.log(`\nRun without --dry-run to apply ${updates.length} updates.\n`);

    // Show sample
    if (updates.length > 0) {
      console.log('Sample updates (first 3):');
      updates.slice(0, 3).forEach((u, i) => {
        console.log(`\n${i + 1}. ${u.personId}`);
        console.log(`   Fields to update: ${u.fieldsUpdated}`);
        console.log(`   Sample fields:`, Object.keys(u.update.$set).slice(0, 5).join(', '));
      });
    }
  } else {
    // Execute updates
    console.log(`Executing ${updates.length} updates...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const updateItem of updates) {
      try {
        await Person.updateOne(
          { _id: updateItem.personId },
          updateItem.update
        );
        successCount++;

        if (successCount % 100 === 0) {
          console.log(`  ${successCount}/${updates.length} updated...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to update ${updateItem.personId}: ${error.message}`);
      }
    }

    console.log('\n' + '━'.repeat(70));
    console.log('UPDATE RESULTS:');
    console.log('━'.repeat(70));
    console.log(`✓ Successfully updated: ${successCount} people`);
    console.log(`✓ Total fields populated: ${stats.totalFieldsRecovered}`);
    if (errorCount > 0) {
      console.log(`✗ Failed: ${errorCount}`);
    }
    console.log('━'.repeat(70) + '\n');
  }
}

async function run() {
  try {
    await connectDB();
    await backfillAllData();
  } catch (error) {
    console.error('Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

run();
