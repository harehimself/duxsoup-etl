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

module.exports = {
  findPersonById,
  findPersonByAlias,
};
