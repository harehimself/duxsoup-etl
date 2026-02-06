const Company = require("../models/company");

async function findCompanyById(companyId) {
  const company =
    (await Company.findOne({ canonical_id: companyId })) ||
    (await Company.findById(companyId));

  if (company) {
    return { source: "companies", company };
  }

  return null;
}

async function findCompanyByAlias(aliasValue) {
  const company = await Company.findOne({
    "aliases.value": aliasValue,
  });

  if (company) {
    return { source: "companies", company };
  }

  return null;
}

module.exports = {
  findCompanyById,
  findCompanyByAlias,
};
