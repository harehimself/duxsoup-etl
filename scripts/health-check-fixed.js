#!/usr/bin/env node
/**
 * Database Health Check (FIXED)
 * Performs comprehensive data quality checks using correct schema understanding
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const DeadLetter = require('../src/models/deadLetter');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function section(emoji, title) {
  console.log(`\n${emoji} ${colorize(title, 'cyan')}`);
}

function issue(level, text, count) {
  const symbol = level === 'critical' ? '✗' : level === 'warning' ? '⚠' : '•';
  const color = level === 'critical' ? 'red' : level === 'warning' ? 'yellow' : 'reset';
  const countStr = count !== undefined ? colorize(` ${count}`, 'bright') : '';
  console.log(`${colorize(symbol, color)} ${text}${countStr}`);
}

function success(text, count) {
  const countStr = count !== undefined ? colorize(` ${count}`, 'bright') : '';
  console.log(`${colorize('✓', 'green')} ${text}${countStr}`);
}

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl';
  const environment = process.env.NODE_ENV || 'development';
  await mongoose.connect(mongoUri);
  console.log(colorize(`Connected to MongoDB (${environment})`, 'green'));
  if (environment === 'development') {
    console.log(colorize('⚠ Running on development database. Use NODE_ENV=production for production.', 'yellow'));
  }
}

async function getBasicStats() {
  const [peopleCount, visitsCount, scansCount, deadLettersCount] = await Promise.all([
    Person.countDocuments(),
    Visit.countDocuments(),
    Scan.countDocuments(),
    DeadLetter.countDocuments()
  ]);

  return { peopleCount, visitsCount, scansCount, deadLettersCount };
}

async function getRecentActivity() {
  const now = new Date();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [visits24h, scans24h, visits7d, scans7d] = await Promise.all([
    Visit.countDocuments({ VisitTime: { $gte: oneDayAgo } }),
    Scan.countDocuments({ ScanTime: { $gte: oneDayAgo } }),
    Visit.countDocuments({ VisitTime: { $gte: sevenDaysAgo } }),
    Scan.countDocuments({ ScanTime: { $gte: sevenDaysAgo } })
  ]);

  return {
    last24h: visits24h + scans24h,
    last7d: visits7d + scans7d
  };
}

async function checkIdentityIssues() {
  const [
    missingCanonicalId,
    missingSalesNavId,
    urlBasedIds,
    duplicateAliases
  ] = await Promise.all([
    // Missing canonical_id
    Person.countDocuments({ canonical_id: { $exists: false } }),

    // Missing Sales Nav ID in aliases
    Person.countDocuments({
      'aliases.type': { $ne: 'salesNavId' }
    }),

    // URL-based IDs (LinkedIn profile URLs used as _id)
    Person.countDocuments({
      _id: { $regex: /^linkedin\.com\// }
    }),

    // Duplicate aliases
    Person.aggregate([
      { $unwind: '$aliases' },
      { $group: {
          _id: { type: '$aliases.type', value: '$aliases.value' },
          count: { $sum: 1 },
          people: { $push: '$_id' }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $count: 'total' }
    ]).then(result => result[0]?.total || 0)
  ]);

  return {
    missingCanonicalId,
    missingSalesNavId,
    urlBasedIds,
    duplicateAliases
  };
}

async function checkDataQuality() {
  const [
    missingNames,
    missingPositions,
    peopleWithoutObservations,
    unreferencedVisits,
    unreferencedScans
  ] = await Promise.all([
    // Missing names in snapshot
    Person.countDocuments({
      $or: [
        { 'snapshot.fullName': { $exists: false } },
        { 'snapshot.fullName': '' },
        { 'snapshot.fullName': null }
      ]
    }),

    // Missing positions in snapshot
    Person.countDocuments({
      $or: [
        { 'snapshot.currentTitle': { $exists: false } },
        { 'snapshot.currentTitle': '' },
        { 'snapshot.currentTitle': null }
      ]
    }),

    // People without ANY observations
    Person.countDocuments({
      $and: [
        { $or: [
            { 'observations.visits': { $size: 0 } },
            { 'observations.visits': { $exists: false } }
          ]
        },
        { $or: [
            { 'observations.scans': { $size: 0 } },
            { 'observations.scans': { $exists: false } }
          ]
        }
      ]
    }),

    // Visits not referenced by any person
    (async () => {
      const referencedVisitIds = await Person.distinct('observations.visits');
      const allVisitIds = await Visit.distinct('_id');
      return allVisitIds.length - referencedVisitIds.length;
    })(),

    // Scans not referenced by any person
    (async () => {
      const referencedScanIds = await Person.distinct('observations.scans');
      const allScanIds = await Scan.distinct('_id');
      return allScanIds.length - referencedScanIds.length;
    })()
  ]);

  return {
    missingNames,
    missingPositions,
    peopleWithoutObservations,
    unreferencedObservations: unreferencedVisits + unreferencedScans,
    unreferencedVisits,
    unreferencedScans
  };
}

async function checkDeadLetters() {
  const [
    byStatus,
    byErrorType,
    oldestPending,
    recentFailureRate
  ] = await Promise.all([
    // Count by status
    DeadLetter.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),

    // Common error types
    DeadLetter.aggregate([
      { $group: {
          _id: {
            code: '$error.code',
            message: '$error.message'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]),

    // Oldest pending
    DeadLetter.findOne({ status: 'pending' })
      .sort({ createdAt: 1 })
      .select('createdAt'),

    // Recent failure rate (last 24h)
    (async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recent, failed] = await Promise.all([
        Visit.countDocuments({ VisitTime: { $gte: oneDayAgo } }) +
        Scan.countDocuments({ ScanTime: { $gte: oneDayAgo } }),
        DeadLetter.countDocuments({ createdAt: { $gte: oneDayAgo } })
      ]);
      return recent > 0 ? (failed / recent * 100).toFixed(1) : 0;
    })()
  ]);

  const statusMap = {};
  byStatus.forEach(s => {
    statusMap[s._id || 'unknown'] = s.count;
  });

  return {
    byStatus: statusMap,
    byErrorType,
    oldestPending: oldestPending?.createdAt,
    recentFailureRate
  };
}

async function checkReferentialIntegrity() {
  // More efficient approach: Get all valid IDs first, then check references
  const [brokenVisitRefs, brokenScanRefs] = await Promise.all([
    // People referencing non-existent visits
    (async () => {
      const validVisitIds = new Set((await Visit.distinct('_id')).map(id => id.toString()));
      const result = await Person.aggregate([
        { $match: { 'observations.visits.0': { $exists: true } } },
        { $unwind: '$observations.visits' },
        { $group: {
            _id: '$observations.visits',
            count: { $sum: 1 }
          }
        }
      ]);

      let brokenCount = 0;
      for (const item of result) {
        if (!validVisitIds.has(item._id.toString())) {
          brokenCount += item.count;
        }
      }
      return brokenCount;
    })(),

    // People referencing non-existent scans
    (async () => {
      const validScanIds = new Set((await Scan.distinct('_id')).map(id => id.toString()));
      const result = await Person.aggregate([
        { $match: { 'observations.scans.0': { $exists: true } } },
        { $unwind: '$observations.scans' },
        { $group: {
            _id: '$observations.scans',
            count: { $sum: 1 }
          }
        }
      ]);

      let brokenCount = 0;
      for (const item of result) {
        if (!validScanIds.has(item._id.toString())) {
          brokenCount += item.count;
        }
      }
      return brokenCount;
    })()
  ]);

  return {
    brokenVisitRefs,
    brokenScanRefs,
    totalBrokenRefs: brokenVisitRefs + brokenScanRefs
  };
}

function determineHealth(stats, identity, quality, deadLetters, integrity) {
  const totalPeople = stats.peopleCount;
  const criticalIssues = [];
  const warnings = [];

  // Identity issues (critical if > 10%)
  const identityIssueRate = ((identity.missingCanonicalId + identity.urlBasedIds) / totalPeople) * 100;
  if (identityIssueRate > 10) {
    criticalIssues.push(`${identityIssueRate.toFixed(1)}% people have identity issues`);
  } else if (identityIssueRate > 5) {
    warnings.push(`${identityIssueRate.toFixed(1)}% people have identity issues`);
  }

  // Data quality (warning if > 5%)
  const qualityIssueRate = ((quality.missingNames + quality.unreferencedObservations) / totalPeople) * 100;
  if (qualityIssueRate > 10) {
    criticalIssues.push(`${qualityIssueRate.toFixed(1)}% data quality issues`);
  } else if (qualityIssueRate > 5) {
    warnings.push(`${qualityIssueRate.toFixed(1)}% data quality issues`);
  }

  // Referential integrity (critical if any broken)
  if (integrity.totalBrokenRefs > 0) {
    criticalIssues.push(`${integrity.totalBrokenRefs} broken observation references`);
  }

  // Dead letters (warning if > 100 pending)
  if (deadLetters.byStatus.pending > 100) {
    warnings.push(`${deadLetters.byStatus.pending} pending dead letters`);
  }

  // Determine overall health
  let health = 'GOOD';
  const priorityActions = [];

  if (criticalIssues.length > 0) {
    health = 'CRITICAL';
    priorityActions.push(...criticalIssues.slice(0, 3));
  } else if (warnings.length > 0) {
    health = 'WARNING';
    priorityActions.push(...warnings.slice(0, 3));
  }

  // Add specific actionable items
  if (identity.urlBasedIds > 0) {
    priorityActions.push(`Migrate ${identity.urlBasedIds} URL-based IDs to stable identifiers`);
  }
  if (quality.unreferencedObservations > 0) {
    priorityActions.push(`Link ${quality.unreferencedObservations} unreferenced observations to people`);
  }
  if (deadLetters.byStatus.pending > 0) {
    priorityActions.push(`Replay ${deadLetters.byStatus.pending} pending dead letters`);
  }

  return { health, priorityActions: priorityActions.slice(0, 3) };
}

async function runHealthCheck() {
  console.log(colorize('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bright'));
  console.log(colorize('        DATABASE HEALTH CHECK', 'bright'));
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bright'));

  try {
    await connectDB();

    console.log(colorize('\nCollecting stats...', 'bright'));
    const stats = await getBasicStats();
    const activity = await getRecentActivity();
    const identity = await checkIdentityIssues();
    const quality = await checkDataQuality();
    const deadLetters = await checkDeadLetters();
    console.log(colorize('Checking referential integrity (this may take a moment)...', 'yellow'));
    const integrity = await checkReferentialIntegrity();

    // Display results
    section('📊', 'BASIC STATS');
    success('People:', stats.peopleCount);
    success('Visits:', stats.visitsCount);
    success('Scans:', stats.scansCount);
    if (stats.deadLettersCount > 0) {
      issue('warning', 'Dead Letters:', stats.deadLettersCount);
    } else {
      success('Dead Letters:', stats.deadLettersCount);
    }

    section('📈', 'RECENT ACTIVITY');
    issue('info', 'Last 24h:', activity.last24h + ' observations');
    issue('info', 'Last 7d:', activity.last7d + ' observations');

    section('🔍', 'IDENTITY ISSUES [priority: high]');
    if (identity.missingCanonicalId > 0) {
      issue('warning', 'Missing canonical_id:', identity.missingCanonicalId);
    } else {
      success('All people have canonical_id');
    }

    if (identity.urlBasedIds > 0) {
      issue('critical', 'URL-based IDs:', identity.urlBasedIds);
    } else {
      success('No URL-based IDs');
    }

    if (identity.duplicateAliases > 0) {
      issue('warning', 'Duplicate aliases:', identity.duplicateAliases);
    } else {
      success('No duplicate aliases');
    }

    if (identity.missingSalesNavId > 0) {
      issue('info', 'Missing Sales Nav ID:', identity.missingSalesNavId);
    }

    section('📋', 'DATA QUALITY [priority: medium]');
    if (quality.missingNames > 0) {
      issue('warning', 'Missing names:', quality.missingNames);
    } else {
      success('All people have names');
    }

    if (quality.missingPositions > 0) {
      issue('info', 'Missing positions:', quality.missingPositions);
    }

    if (quality.unreferencedObservations > 0) {
      issue('warning', 'Unreferenced observations:', quality.unreferencedObservations);
      issue('info', '  - Unreferenced visits:', quality.unreferencedVisits);
      issue('info', '  - Unreferenced scans:', quality.unreferencedScans);
    } else {
      success('All observations are referenced by people');
    }

    if (quality.peopleWithoutObservations > 0) {
      issue('info', 'People without observations:', quality.peopleWithoutObservations);
    }

    section('🔗', 'REFERENTIAL INTEGRITY');
    if (integrity.totalBrokenRefs > 0) {
      issue('critical', 'Broken observation references:', integrity.totalBrokenRefs);
      issue('info', '  - Broken visit refs:', integrity.brokenVisitRefs);
      issue('info', '  - Broken scan refs:', integrity.brokenScanRefs);
    } else {
      success('All observation references are valid');
    }

    section('💀', 'DEAD LETTERS');
    if (deadLetters.byStatus.pending > 0) {
      issue('warning', 'Pending:', deadLetters.byStatus.pending);
    } else {
      success('Pending: 0');
    }

    if (deadLetters.byStatus.failed_again > 0) {
      issue('critical', 'Failed again:', deadLetters.byStatus.failed_again);
    }

    if (deadLetters.byStatus.replayed > 0) {
      issue('info', 'Replayed:', deadLetters.byStatus.replayed);
    }

    if (deadLetters.byErrorType.length > 0) {
      console.log('\n  Common errors:');
      deadLetters.byErrorType.forEach(err => {
        const code = err._id?.code || 'UNKNOWN';
        const message = err._id?.message || 'No message';
        const truncatedMsg = message.length > 60 ? message.substring(0, 60) + '...' : message;
        console.log(`    - [${code}] ${truncatedMsg}: ${colorize(err.count, 'bright')}`);
      });
    }

    if (deadLetters.oldestPending) {
      const age = Math.floor((Date.now() - deadLetters.oldestPending) / (24 * 60 * 60 * 1000));
      issue('info', `Oldest pending dead letter: ${age} days old`);
    }

    if (parseFloat(deadLetters.recentFailureRate) > 0) {
      const rate = parseFloat(deadLetters.recentFailureRate);
      const level = rate > 5 ? 'warning' : 'info';
      issue(level, `Recent failure rate (24h): ${rate}%`);
    }

    // Summary
    const { health, priorityActions } = determineHealth(stats, identity, quality, deadLetters, integrity);

    console.log('\n' + colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'bright'));
    section('📊', 'SUMMARY');

    const healthColor = health === 'CRITICAL' ? 'red' : health === 'WARNING' ? 'yellow' : 'green';
    console.log(`Overall health: ${colorize(health, healthColor)}`);

    if (priorityActions.length > 0) {
      console.log('\nPriority actions:');
      priorityActions.forEach((action, i) => {
        console.log(`  ${i + 1}. ${action}`);
      });
    } else {
      console.log('\n' + colorize('✓ No critical issues detected', 'green'));
    }

    console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'bright'));

  } catch (error) {
    console.error(colorize('\n✗ Health check failed:', 'red'), error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runHealthCheck();
