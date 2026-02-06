const Location = require("../models/location");

async function findLocationById(locationId) {
  const location =
    (await Location.findOne({ canonical_id: locationId })) ||
    (await Location.findById(locationId));

  if (location) {
    return { source: "locations", location };
  }

  return null;
}

async function findLocationByAlias(aliasValue) {
  const location = await Location.findOne({
    "aliases.value": aliasValue,
  });

  if (location) {
    return { source: "locations", location };
  }

  return null;
}

module.exports = {
  findLocationById,
  findLocationByAlias,
};
