const companyReadService = require('../services/companyReadService');
const logger = require('../utils/logger');
const { getConfig } = require('../utils/env');

async function getCompanyById(req, res) {
  const { id } = req.params;
  const config = getConfig();

  logger.info('Get company by ID', {
    company_id: id,
    read_source: config.readSource,
  });

  try {
    const result = await companyReadService.findCompanyById(id);

    if (!result) {
      return res.status(404).json({
        error: 'Company not found',
        company_id: id,
        read_source: config.readSource,
      });
    }

    res.json({
      success: true,
      source: result.source,
      read_source: config.readSource,
      company: result.company,
    });
  } catch (error) {
    logger.error('Error getting company by ID', {
      company_id: id,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to get company',
      message: error.message,
    });
  }
}

async function getCompanyByAlias(req, res) {
  const { value } = req.params;
  const config = getConfig();

  logger.info('Get company by alias', {
    alias_value: value,
    read_source: config.readSource,
  });

  try {
    const result = await companyReadService.findCompanyByAlias(value);

    if (!result) {
      return res.status(404).json({
        error: 'Company not found',
        alias_value: value,
        read_source: config.readSource,
      });
    }

    res.json({
      success: true,
      source: result.source,
      read_source: config.readSource,
      company: result.company,
    });
  } catch (error) {
    logger.error('Error getting company by alias', {
      alias_value: value,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to get company',
      message: error.message,
    });
  }
}

module.exports = {
  getCompanyById,
  getCompanyByAlias,
};
