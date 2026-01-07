const Company = require('../models/company');
const { getConfig } = require('../utils/env');
const logger = require('../utils/logger');

async function findCompanyById(companyId) {
  const config = getConfig();

  if (config.readSource === 'legacy') {
    return null;
  }

  const company = await Company.findOne({ canonical_id: companyId }) || await Company.findById(companyId);

  if (company) {
    return { source: 'companies', company };
  }

  return null;
}

async function findCompanyByAlias(aliasValue) {
  const config = getConfig();

  if (config.readSource === 'legacy') {
    return null;
  }

  const company = await Company.findOne({
    'aliases.value': aliasValue,
  });

  if (company) {
    return { source: 'companies', company };
  }

  return null;
}

module.exports = {
  findCompanyById,
  findCompanyByAlias,
};
