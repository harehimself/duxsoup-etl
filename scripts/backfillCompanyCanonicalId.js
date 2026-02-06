#!/usr/bin/env node

/**
 * Company Canonical ID Backfill
 *
 * Populates canonical_id for companies missing it.
 * Priority: numericId alias > profileUrl alias > name alias > snapshot fields.
 *
 * Usage:
 *   node scripts/backfillCompanyCanonicalId.js [options]
 *
 * Options:
 *   --dry-run            Preview updates without saving (default)
 *   --commit             Execute updates (required to make changes)
 *   --limit=N            Limit to N companies (default: 1000)
 *   --batch-size=N       Process N companies per batch (default: 100)
 */

const mongoose = require('mongoose');
const Company = require('../src/models/company');
const logger = require('../src/utils/logger');
const {
  extractCompanyProfileUrl,
  buildCanonicalKey,
  computeCanonicalId,
} = require('../src/utils/identityMatcher');

function parseArgs() {
  const args = {
    dryRun: true,
    commit: false,
    limit: 1000,
    batchSize: 100,
  };

  process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace('--', '').split('=');
    if (key === 'dry-run') args.dryRun = true;
    else if (key === 'commit') {
      args.dryRun = false;
      args.commit = true;
    } else if (key === 'limit') args.limit = parseInt(value, 10);
    else if (key === 'batch-size') args.batchSize = parseInt(value, 10);
  });

  return args;
}

function pickPrimaryAlias(aliases = []) {
  const numeric = aliases.find(a => a.type === 'numericId' && a.value);
  if (numeric) return { type: 'numericId', value: numeric.value };

  const profile = aliases.find(a => a.type === 'profileUrl' && a.value);
  if (profile) {
    return {
      type: 'profileUrl',
      value: extractCompanyProfileUrl(profile.value) || profile.value,
    };
  }

  const name = aliases.find(a => a.type === 'name' && a.value);
  if (name) return { type: 'name', value: name.value };

  return null;
}

function inferPrimaryFromSnapshot(company) {
  if (company.snapshot?.companyProfileUrl) {
    const normalized = extractCompanyProfileUrl(company.snapshot.companyProfileUrl);
    if (normalized) return { type: 'profileUrl', value: normalized };
  }

  if (company.snapshot?.name) {
    return { type: 'name', value: company.snapshot.name.trim() };
  }

  return null;
}

function computeCanonicalForCompany(company) {
  const primary = pickPrimaryAlias(company.aliases) || inferPrimaryFromSnapshot(company);
  if (!primary) return null;

  const canonicalKey = buildCanonicalKey(primary.type, primary.value);
  const canonicalId = computeCanonicalId(canonicalKey);

  if (!canonicalId) return null;

  return {
    canonical_id: canonicalId,
    canonical_key: canonicalKey,
    primary_type: primary.type,
    primary_value: primary.value,
  };
}

async function backfillCompanyCanonicalId(args) {
  console.log('🏢 Starting company canonical_id backfill...');
  console.log('Options:', args);
  console.log('');

  if (args.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
    console.log('   Use --commit to execute updates\n');
  }

  const stats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB\n');

    const query = {
      $or: [
        { canonical_id: { $exists: false } },
        { canonical_id: null },
        { canonical_id: '' },
      ],
    };

    const companies = await Company.find(query)
      .limit(args.limit)
      .lean();

    console.log(`Found ${companies.length} companies missing canonical_id\n`);

    for (let i = 0; i < companies.length; i += args.batchSize) {
      const batch = companies.slice(i, i + args.batchSize);

      for (const company of batch) {
        stats.processed += 1;
        const computed = computeCanonicalForCompany(company);

        if (!computed) {
          stats.skipped += 1;
          logger.warn('Skipping company: no canonical key available', {
            company_id: company._id,
          });
          continue;
        }

        if (args.dryRun) {
          logger.info('Would update company canonical_id', {
            company_id: company._id,
            canonical_id: computed.canonical_id,
            canonical_key: computed.canonical_key,
          });
          stats.updated += 1;
          continue;
        }

        try {
          await Company.updateOne(
            { _id: company._id },
            { $set: { canonical_id: computed.canonical_id } }
          );
          stats.updated += 1;
        } catch (error) {
          stats.failed += 1;
          logger.error('Failed to update company canonical_id', {
            company_id: company._id,
            error: error.message,
          });
        }
      }
    }

    console.log('\n✅ Company canonical_id backfill complete');
    console.log('Stats:', stats);
  } catch (error) {
    logger.error('Company canonical_id backfill failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

const args = parseArgs();

backfillCompanyCanonicalId(args)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
