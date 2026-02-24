#!/usr/bin/env node
/**
 * Database Health Check
 * Performs comprehensive data quality checks and reports issues
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const Person = require('../src/models/person');
const Visit = require('../src/models/visit');
const Scan = require('../src/models/scan');
const DeadLetter = require('../src/models/deadLetter');

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function header(text) {
  console.log('\n' + colorize(text, 'bright'));
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
  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME || "duxsoup" });
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

  // Count recent visits and scans
  const [visits24h, scans24h, visits7d, scans7d] = await Promise.all([
    Visit.countDocuments({ observedAt: { $gte: oneDayAgo } }),
    Scan.countDocuments({ observedAt: { $gte: oneDayAgo } }),
    Visit.countDocuments({ observedAt: { $gte: sevenDaysAgo } }),
    Scan.countDocuments({ observedAt: { $gte: sevenDaysAgo } })
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

    // Missing Sales Nav ID
    Person.countDocuments({
      'aliases.type': { $ne: 'sales_nav_id' }
    }),

    // URL-based IDs (LinkedIn profile URLs used as _id)
    Person.countDocuments({
      _id: { $regex: /^https?:\/\// }
    }),

    // Duplicate aliases - need aggregation
    Person.aggregate([
      { $unwind: '$aliases' },
      { $group: {
          _id: { type: '$aliases.type', value: '$aliases.value' },
          count: { $sum: 1 }
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
    orphanedVisits,
    orphanedScans,
    observationsWithoutStableIds
  ] = await Promise.all([
    // Missing critical fields
    Person.countDocuments({
      $or: [
        { fullName: { $exists: false } },
        { fullName: '' }
      ]
    }),

    Person.countDocuments({
      $or: [
        { currentTitle: { $exists: false } },
        { currentTitle: '' }
      ]
    }),

    // People without observations
    Person.countDocuments({
      $or: [
        { visits: { $size: 0 } },
        { visits: { $exists: false } }
      ],
      $or: [
        { scans: { $size: 0 } },
        { scans: { $exists: false } }
      ]
    }),

    // Orphaned observations (person_id not in people)
    Visit.aggregate([
      {
        $lookup: {
          from: 'people',
          localField: 'person_id',
          foreignField: '_id',
          as: 'person'
        }
      },
      { $match: { person: { $size: 0 } } },
      { $count: 'total' }
    ]).then(result => result[0]?.total || 0),

    Scan.aggregate([
      {
        $lookup: {
          from: 'people',
          localField: 'person_id',
          foreignField: '_id',
          as: 'person'
        }
      },
      { $match: { person: { $size: 0 } } },
      { $count: 'total' }
    ]).then(result => result[0]?.total || 0),

    // Observations without stable IDs (no sales_nav_id or numeric_id)
    Promise.all([
      Visit.countDocuments({
        sales_nav_id: { $exists: false },
        numeric_id: { $exists: false }
      }),
      Scan.countDocuments({
        sales_nav_id: { $exists: false },
        numeric_id: { $exists: false }
      })
    ]).then(([v, s]) => v + s)
  ]);

  return {
    missingNames,
    missingPositions,
    peopleWithoutObservations,
    orphanedObservations: orphanedVisits + orphanedScans,
    observationsWithoutStableIds
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
      .sort({ created_at: 1 })
      .select('created_at'),

    // Recent failure rate (last 24h)
    (async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recent, failed] = await Promise.all([
        Visit.countDocuments({ observedAt: { $gte: oneDayAgo } }) +
        Scan.countDocuments({ observedAt: { $gte: oneDayAgo } }),
        DeadLetter.countDocuments({ created_at: { $gte: oneDayAgo } })
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
    oldestPending: oldestPending?.created_at,
    recentFailureRate
  };
}

async function checkRoleIssues() {
  // People with overlapping role timelines
  const overlappingRoles = await Person.aggregate([
    { $match: { 'roles.1': { $exists: true } } }, // At least 2 roles
    {
      $project: {
        fullName: 1,
        hasOverlap: {
          $anyElementTrue: {
            $map: {
              input: '$roles',
              as: 'role1',
              in: {
                $anyElementTrue: {
                  $map: {
                    input: '$roles',
                    as: 'role2',
                    in: {
                      $and: [
                        { $ne: ['$$role1', '$$role2'] },
                        { $lt: ['$$role1.start', { $ifNull: ['$$role2.end', new Date()] }] },
                        { $gt: [{ $ifNull: ['$$role1.end', new Date()] }, '$$role2.start'] }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    { $match: { hasOverlap: true } },
    { $count: 'total' }
  ]);

  return {
    overlappingRoles: overlappingRoles[0]?.total || 0
  };
}

function determineHealth(stats, identity, quality, deadLetters) {
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
  const qualityIssueRate = ((quality.missingNames + quality.orphanedObservations) / totalPeople) * 100;
  if (qualityIssueRate > 5) {
    warnings.push(`${qualityIssueRate.toFixed(1)}% data quality issues`);
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
  if (quality.orphanedObservations > 0) {
    priorityActions.push(`Fix ${quality.orphanedObservations} orphaned observations`);
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

    header('Collecting stats...');
    const stats = await getBasicStats();
    const activity = await getRecentActivity();
    const identity = await checkIdentityIssues();
    const quality = await checkDataQuality();
    const deadLetters = await checkDeadLetters();
    const roles = await checkRoleIssues();

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

    if (quality.orphanedObservations > 0) {
      issue('warning', 'Orphaned observations:', quality.orphanedObservations);
    } else {
      success('No orphaned observations');
    }

    if (quality.observationsWithoutStableIds > 0) {
      issue('info', 'Observations without stable IDs:', quality.observationsWithoutStableIds);
    }

    if (quality.peopleWithoutObservations > 0) {
      issue('info', 'People without observations:', quality.peopleWithoutObservations);
    }

    section('👥', 'ROLE & COMPANY ISSUES');
    if (roles.overlappingRoles > 0) {
      issue('warning', 'People with overlapping role timelines:', roles.overlappingRoles);
    } else {
      success('No overlapping role timelines');
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
    const { health, priorityActions } = determineHealth(stats, identity, quality, deadLetters);

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

// Run the health check
runHealthCheck().catch(console.error);
