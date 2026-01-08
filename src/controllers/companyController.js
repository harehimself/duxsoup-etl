const Company = require('../models/company');
const logger = require('../utils/logger');
const { resolveCompanyIdentity } = require('../utils/identityResolver');
const { dedupeAliases } = require('../utils/aliasHelpers');

function applySnapshotValue(snapshot, field, value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (snapshot[field] === value) return false;
  snapshot[field] = value;
  return true;
}

async function upsertCompanyFromObservation(observationDoc, sourceType) {
  const webhookData = observationDoc.rawData || observationDoc;
  const identity = resolveCompanyIdentity(webhookData);

  if (!identity.company_id || !identity.canonical_id) {
    logger.info('Cannot upsert company without stable ID', {
      observation_id: observationDoc._id,
      sourceType,
      company_name: webhookData.Company || 'unknown',
    });
    return null;
  }

  const observedAt = webhookData.VisitTime || webhookData.ScanTime || new Date();
  const observationId = observationDoc._id;

  let company = await Company.findOne({ canonical_id: identity.canonical_id });

  if (!company) {
    company = await Company.create({
      _id: identity.company_id,
      canonical_id: identity.canonical_id,
      aliases: dedupeAliases(identity.aliases),
      snapshot: {},
      observations: { visits: [], scans: [] },
      meta: {},
    });
  } else {
    const mergedAliases = dedupeAliases([...(company.aliases || []), ...(identity.aliases || [])]);
    company.aliases = mergedAliases;
  }

  // Use $addToSet for atomic uniqueness on observation references
  const observationField = sourceType === 'visit' ? 'observations.visits' : 'observations.scans';
  await Company.updateOne(
    { _id: company._id },
    { $addToSet: { [observationField]: observationId } }
  );

  // Reload to get updated observations count
  company = await Company.findById(company._id);

  company.meta = company.meta || {};
  company.meta.lastObservedAt = observedAt;
  company.meta.lastObservation = {
    type: sourceType,
    id: observationId,
    observedAt: observedAt,
  };
  company.meta.observationsCount =
    (company.observations.visits.length || 0) + (company.observations.scans.length || 0);

  company.snapshot = company.snapshot || {};
  applySnapshotValue(company.snapshot, 'name', webhookData.Company);
  applySnapshotValue(company.snapshot, 'industry', webhookData.Industry);
  applySnapshotValue(company.snapshot, 'companyProfileUrl', webhookData.CompanyProfile);
  applySnapshotValue(company.snapshot, 'website', webhookData.CompanyWebsite);

  await company.save();

  logger.info('Upserted company from observation', {
    company_id: company._id,
    canonical_id: company.canonical_id,
    observation_id: observationId,
    sourceType,
  });

  return company;
}

module.exports = {
  upsertCompanyFromObservation,
};
