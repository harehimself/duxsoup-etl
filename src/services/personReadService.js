const Person = require("../models/person");
const logger = require("../utils/logger");

/**
 * Person Read Service
 *
 * Reads person data from the people collection.
 */

/**
 * Find person by canonical ID or _id
 */
async function findPersonById(personId) {
  const person =
    (await Person.findOne({ canonical_id: personId })) ||
    (await Person.findById(personId));

  if (person) {
    logger.debug("Person found in people collection", { personId });
    return { source: "people", person };
  }

  return null;
}

/**
 * Find person by alias (Sales Nav ID, numeric ID, or public URL)
 */
async function findPersonByAlias(aliasValue) {
  const person = await Person.findOne({
    "aliases.value": aliasValue,
  });

  if (person) {
    logger.debug("Person found by alias in people collection", { aliasValue });
    return { source: "people", person };
  }

  return null;
}

/**
 * Find multiple people by alias values in a single query.
 * Returns a Map of aliasValue -> person document.
 */
async function findPeopleByAliases(aliasValues) {
  const people = await Person.find({
    "aliases.value": { $in: aliasValues },
  }).lean();

  const resultMap = new Map();
  for (const person of people) {
    for (const alias of person.aliases) {
      if (aliasValues.includes(alias.value)) {
        resultMap.set(alias.value, person);
      }
    }
  }

  return resultMap;
}

module.exports = {
  findPersonById,
  findPersonByAlias,
  findPeopleByAliases,
};
