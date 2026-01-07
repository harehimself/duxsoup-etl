const Location = require('../models/location');
const { getConfig } = require('../utils/env');

async function findLocationById(locationId) {
  const config = getConfig();

  if (config.readSource === 'legacy') {
    return null;
  }

  const location = await Location.findOne({ canonical_id: locationId }) || await Location.findById(locationId);

  if (location) {
    return { source: 'locations', location };
  }

  return null;
}

async function findLocationByAlias(aliasValue) {
  const config = getConfig();

  if (config.readSource === 'legacy') {
    return null;
  }

  const location = await Location.findOne({
    'aliases.value': aliasValue,
  });

  if (location) {
    return { source: 'locations', location };
  }

  return null;
}

module.exports = {
  findLocationById,
  findLocationByAlias,
};
