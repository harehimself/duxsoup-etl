const express = require('express');
const router = express.Router();
const Person = require('../models/person');
const { getSeniorityTiers } = require('../utils/titleParser');
const logger = require('../utils/logger');

/**
 * Seniority Routes
 *
 * Endpoints for filtering and analyzing people by seniority tier
 */

/**
 * GET /api/seniority/tiers
 * Get all available seniority tiers
 */
router.get('/tiers', async (req, res) => {
  try {
    const tiers = getSeniorityTiers();
    res.json({
      success: true,
      data: tiers,
    });
  } catch (error) {
    logger.error('Error fetching seniority tiers', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch seniority tiers',
    });
  }
});

/**
 * GET /api/seniority/distribution
 * Get distribution of people by seniority tier
 *
 * Query params:
 *   - groupBy: 'highest' (default) | 'all' - Group by highest role or all roles
 */
router.get('/distribution', async (req, res) => {
  try {
    const { groupBy = 'highest' } = req.query;

    let distribution;

    if (groupBy === 'all') {
      // Distribution across ALL roles
      distribution = await Person.aggregate([
        { $unwind: '$snapshot.roles' },
        {
          $match: {
            'snapshot.roles.seniority': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$snapshot.roles.seniority',
            count: { $sum: 1 },
            avgRank: { $avg: '$snapshot.roles.seniorityRank' },
          },
        },
        { $sort: { avgRank: -1 } },
        {
          $project: {
            _id: 0,
            tier: '$_id',
            count: 1,
            avgRank: { $round: ['$avgRank', 1] },
          },
        },
      ]);
    } else {
      // Distribution by highest role per person
      distribution = await Person.aggregate([
        {
          $match: {
            'derived.highestSeniority': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$derived.highestSeniority',
            count: { $sum: 1 },
            avgRank: { $avg: '$derived.highestSeniorityRank' },
          },
        },
        { $sort: { avgRank: -1 } },
        {
          $project: {
            _id: 0,
            tier: '$_id',
            count: 1,
            avgRank: { $round: ['$avgRank', 1] },
          },
        },
      ]);
    }

    // Calculate percentages
    const total = distribution.reduce((sum, item) => sum + item.count, 0);
    distribution = distribution.map((item) => ({
      ...item,
      percentage: Math.round((item.count / total) * 1000) / 10,
    }));

    res.json({
      success: true,
      data: {
        distribution,
        total,
        groupBy,
      },
    });
  } catch (error) {
    logger.error('Error fetching seniority distribution', {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch seniority distribution',
    });
  }
});

/**
 * GET /api/seniority/filter
 * Filter people by seniority criteria
 *
 * Query params:
 *   - tier: Specific tier name (e.g., "VP", "CXO")
 *   - minRank: Minimum seniority rank (1-8)
 *   - maxRank: Maximum seniority rank (1-8)
 *   - department: Filter by department (e.g., "engineering", "sales")
 *   - company: Filter by company name (case-insensitive)
 *   - limit: Max results (default: 50, max: 500)
 *   - offset: Skip results (default: 0)
 *   - sortBy: 'rank' (default) | 'name' | 'company'
 *   - sortOrder: 'desc' (default) | 'asc'
 */
router.get('/filter', async (req, res) => {
  try {
    const {
      tier,
      minRank,
      maxRank,
      department,
      company,
      limit = 50,
      offset = 0,
      sortBy = 'rank',
      sortOrder = 'desc',
    } = req.query;

    // Build query
    const query = { 'snapshot.roles': { $exists: true, $ne: [] } };

    // Build roles filter
    const rolesFilter = {};

    if (tier) {
      rolesFilter['snapshot.roles.seniority'] = tier;
    }

    if (minRank || maxRank) {
      rolesFilter['snapshot.roles.seniorityRank'] = {};
      if (minRank) rolesFilter['snapshot.roles.seniorityRank'].$gte = parseInt(minRank);
      if (maxRank) rolesFilter['snapshot.roles.seniorityRank'].$lte = parseInt(maxRank);
    }

    if (department) {
      // Search in role titles for department keywords
      rolesFilter['snapshot.roles.title'] = new RegExp(department, 'i');
    }

    if (company) {
      query['snapshot.currentCompany'] = new RegExp(company, 'i');
    }

    // Apply roles filter
    if (Object.keys(rolesFilter).length > 0) {
      query['snapshot.roles'] = { $elemMatch: rolesFilter };
    }

    // Build sort
    const sortOptions = {};
    if (sortBy === 'rank') {
      sortOptions['derived.highestSeniorityRank'] = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'name') {
      sortOptions['snapshot.fullName'] = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'company') {
      sortOptions['snapshot.currentCompany'] = sortOrder === 'asc' ? 1 : -1;
    }

    // Execute query
    const parsedLimit = Math.min(parseInt(limit) || 50, 500);
    const parsedOffset = parseInt(offset) || 0;

    const [people, total] = await Promise.all([
      Person.find(query)
        .select(
          'snapshot.fullName snapshot.currentTitle snapshot.currentCompany snapshot.roles.title snapshot.roles.seniority snapshot.roles.seniorityRank derived.highestSeniority derived.highestSeniorityRank',
        )
        .sort(sortOptions)
        .skip(parsedOffset)
        .limit(parsedLimit)
        .lean(),
      Person.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        people,
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        filters: { tier, minRank, maxRank, department, company },
      },
    });
  } catch (error) {
    logger.error('Error filtering by seniority', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to filter by seniority',
    });
  }
});

/**
 * GET /api/seniority/search
 * Search for people by name with seniority filtering
 *
 * Query params:
 *   - q: Search query (name)
 *   - tier: Filter by specific tier
 *   - minRank: Minimum seniority rank
 *   - limit: Max results (default: 20)
 */
router.get('/search', async (req, res) => {
  try {
    const { q, tier, minRank, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUERY',
        message: 'Search query must be at least 2 characters',
      });
    }

    // Build query
    const query = {
      'snapshot.fullName': new RegExp(q, 'i'),
    };

    if (tier) {
      query['derived.highestSeniority'] = tier;
    }

    if (minRank) {
      query['derived.highestSeniorityRank'] = { $gte: parseInt(minRank) };
    }

    const people = await Person.find(query)
      .select(
        'snapshot.fullName snapshot.currentTitle snapshot.currentCompany derived.highestSeniority derived.highestSeniorityRank',
      )
      .limit(Math.min(parseInt(limit) || 20, 100))
      .lean();

    res.json({
      success: true,
      data: {
        people,
        count: people.length,
        query: q,
      },
    });
  } catch (error) {
    logger.error('Error searching with seniority filter', {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to search people',
    });
  }
});

/**
 * GET /api/seniority/stats
 * Get comprehensive seniority statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [distributionByHighest, distributionByAll, topCompanies] =
      await Promise.all([
        // Distribution by highest role
        Person.aggregate([
          {
            $match: {
              'derived.highestSeniority': { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: '$derived.highestSeniority',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),

        // Distribution across all roles
        Person.aggregate([
          { $unwind: '$snapshot.roles' },
          {
            $match: {
              'snapshot.roles.seniority': { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: '$snapshot.roles.seniority',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),

        // Top companies by seniority
        Person.aggregate([
          {
            $match: {
              'derived.highestSeniorityRank': { $gte: 5 },
              'snapshot.currentCompany': { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: '$snapshot.currentCompany',
              count: { $sum: 1 },
              avgRank: { $avg: '$derived.highestSeniorityRank' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
      ]);

    res.json({
      success: true,
      data: {
        byHighestRole: distributionByHighest,
        byAllRoles: distributionByAll,
        topCompaniesWithSeniorLeaders: topCompanies,
      },
    });
  } catch (error) {
    logger.error('Error fetching seniority stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch statistics',
    });
  }
});

module.exports = router;
