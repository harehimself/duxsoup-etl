#!/usr/bin/env node

/**
 * Investigate Company ETL Flow
 *
 * Checks when last company was created and analyzes recent observations
 * to determine if company data is being extracted correctly.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const database = require('../src/utils/database');
const Company = require('../src/models/company');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');

async function investigate() {
  try {
    console.log('Connecting to database...\n');
    await database.connect();

    // Check last company created
    const lastCompany = await Company.findOne().sort({ createdAt: -1 });
    const companyCount = await Company.countDocuments();

    console.log('========================================');
    console.log('COMPANY COLLECTION STATUS');
    console.log('========================================');
    console.log(`Total companies: ${companyCount}`);
    console.log(`Last company created: ${lastCompany?.createdAt || 'NEVER'}`);
    if (lastCompany) {
      console.log(`Last company ID: ${lastCompany._id}`);
      console.log(`Last company name: ${lastCompany.snapshot?.name || 'N/A'}`);
    }
    console.log('');

    // Check recent visits for company data
    const recentVisits = await Visit.find().sort({ createdAt: -1 }).limit(10);
    console.log('========================================');
    console.log('RECENT VISITS - COMPANY DATA');
    console.log('========================================');
    console.log(`Analyzed ${recentVisits.length} most recent visits:\n`);

    let visitsWithCompany = 0;
    let visitsWithCompanyID = 0;
    let visitsWithCompanyProfile = 0;

    recentVisits.forEach((v, idx) => {
      // Try the correct path first
      const dataCorrect = v.rawData?.data;
      const dataWrong = v.rawData;

      console.log(`Visit ${idx + 1} (${v._id.toString().slice(-8)}):`);
      console.log(`  Created: ${v.createdAt}`);
      console.log(`  rawData.data exists: ${!!dataCorrect}`);

      if (dataCorrect) {
        console.log(`  - Company (rawData.data): ${dataCorrect.Company || 'MISSING'}`);
        console.log(`  - CompanyID (rawData.data): ${dataCorrect.CompanyID || 'MISSING'}`);
        console.log(`  - CompanyProfile (rawData.data): ${dataCorrect.CompanyProfile ? 'PRESENT' : 'MISSING'}`);

        if (dataCorrect.Company) visitsWithCompany++;
        if (dataCorrect.CompanyID) visitsWithCompanyID++;
        if (dataCorrect.CompanyProfile) visitsWithCompanyProfile++;
      }

      if (dataWrong && !dataCorrect) {
        console.log(`  - Company (rawData): ${dataWrong.Company || 'MISSING'}`);
        console.log(`  - CompanyID (rawData): ${dataWrong.CompanyID || 'MISSING'}`);
        console.log(`  - CompanyProfile (rawData): ${dataWrong.CompanyProfile ? 'PRESENT' : 'MISSING'}`);
      }

      console.log('');
    });

    console.log('Summary:');
    console.log(`  Visits with Company name: ${visitsWithCompany}/${recentVisits.length}`);
    console.log(`  Visits with CompanyID: ${visitsWithCompanyID}/${recentVisits.length}`);
    console.log(`  Visits with CompanyProfile: ${visitsWithCompanyProfile}/${recentVisits.length}`);
    console.log('');

    // Check recent scans for company data
    const recentScans = await Scan.find().sort({ createdAt: -1 }).limit(10);
    console.log('========================================');
    console.log('RECENT SCANS - COMPANY DATA');
    console.log('========================================');
    console.log(`Analyzed ${recentScans.length} most recent scans:\n`);

    let scansWithCompany = 0;
    let scansWithCompanyID = 0;
    let scansWithCompanyProfile = 0;

    recentScans.forEach((s, idx) => {
      // Try the correct path first
      const dataCorrect = s.rawData?.data;
      const dataWrong = s.rawData;

      console.log(`Scan ${idx + 1} (${s._id.toString().slice(-8)}):`);
      console.log(`  Created: ${s.createdAt}`);
      console.log(`  rawData.data exists: ${!!dataCorrect}`);

      if (dataCorrect) {
        console.log(`  - Company (rawData.data): ${dataCorrect.Company || 'MISSING'}`);
        console.log(`  - CompanyID (rawData.data): ${dataCorrect.CompanyID || 'MISSING'}`);
        console.log(`  - CompanyProfile (rawData.data): ${dataCorrect.CompanyProfile ? 'PRESENT' : 'MISSING'}`);

        if (dataCorrect.Company) scansWithCompany++;
        if (dataCorrect.CompanyID) scansWithCompanyID++;
        if (dataCorrect.CompanyProfile) scansWithCompanyProfile++;
      }

      if (dataWrong && !dataCorrect) {
        console.log(`  - Company (rawData): ${dataWrong.Company || 'MISSING'}`);
        console.log(`  - CompanyID (rawData): ${dataWrong.CompanyID || 'MISSING'}`);
        console.log(`  - CompanyProfile (rawData): ${dataWrong.CompanyProfile ? 'PRESENT' : 'MISSING'}`);
      }

      console.log('');
    });

    console.log('Summary:');
    console.log(`  Scans with Company name: ${scansWithCompany}/${recentScans.length}`);
    console.log(`  Scans with CompanyID: ${scansWithCompanyID}/${recentScans.length}`);
    console.log(`  Scans with CompanyProfile: ${scansWithCompanyProfile}/${recentScans.length}`);
    console.log('');

    // Diagnosis
    console.log('========================================');
    console.log('DIAGNOSIS');
    console.log('========================================');

    if (!lastCompany) {
      console.log('❌ NO COMPANIES EVER CREATED');
    } else {
      const daysSinceLastCompany = Math.floor((new Date() - lastCompany.createdAt) / (1000 * 60 * 60 * 24));
      if (daysSinceLastCompany > 7) {
        console.log(`⚠️  Last company created ${daysSinceLastCompany} days ago`);
      } else {
        console.log(`✅ Companies being created (last ${daysSinceLastCompany} days ago)`);
      }
    }

    if (visitsWithCompanyID === 0 && scansWithCompanyID === 0) {
      console.log('⚠️  NO CompanyID data in recent observations');
      console.log('   This could indicate:');
      console.log('   1. DuxSoup not providing CompanyID');
      console.log('   2. Wrong payload path being read');
    }

    if (visitsWithCompany > 0 || scansWithCompany > 0) {
      console.log('✅ Company names ARE present in observations');
      if (visitsWithCompanyID === 0 && scansWithCompanyID === 0) {
        console.log('   But CompanyID missing - companies would fall back to name-based IDs');
        console.log('   This will FAIL because Company model requires numeric IDs');
      }
    }

    console.log('');

    await database.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  investigate();
}

module.exports = { investigate };
