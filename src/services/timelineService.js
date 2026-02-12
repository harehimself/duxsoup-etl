const Visit = require("../models/visit");
const Scan = require("../models/scan");
const Change = require("../models/change");
const { findPersonById } = require("./personReadService");
const logger = require("../utils/logger");

const VISIT_SELECT =
  "VisitTime First Name Last Name Title Company Location connections";
const SCAN_SELECT =
  "ScanTime First Name Last Name Title Company Location connections";

/**
 * Build a unified timeline for a person by merging visits, scans, and changes.
 *
 * @param {string} personId - Person _id or canonical_id
 * @param {Object} opts
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.from] - ISO date lower bound
 * @param {string} [opts.to]   - ISO date upper bound
 * @returns {{ timeline: Object[], metadata: Object }}
 */
async function getPersonTimeline(
  personId,
  { limit = 50, offset = 0, from, to } = {},
) {
  const result = await findPersonById(personId);
  if (!result) {
    return null;
  }

  const { person } = result;

  const visitIds = person.observations?.visits || [];
  const scanIds = person.observations?.scans || [];

  const [visits, scans, changes] = await Promise.all([
    visitIds.length > 0
      ? Visit.find({ _id: { $in: visitIds } })
          .select(VISIT_SELECT)
          .lean()
      : [],
    scanIds.length > 0
      ? Scan.find({ _id: { $in: scanIds } })
          .select(SCAN_SELECT)
          .lean()
      : [],
    Change.find({ person_id: person._id }).lean(),
  ]);

  const events = [];

  // Synthetic first_seen event
  if (person.createdAt) {
    events.push({
      timestamp: person.createdAt,
      type: "first_seen",
      source: { type: "person", id: String(person._id) },
      snapshot: {
        currentTitle: person.snapshot?.currentTitle || null,
        currentCompany: person.snapshot?.currentCompany || null,
        location: person.snapshot?.location || null,
      },
    });
  }

  for (const v of visits) {
    events.push({
      timestamp: v.VisitTime,
      type: "visit",
      source: { type: "visit", id: String(v._id) },
      snapshot: {
        currentTitle: v.Title || null,
        currentCompany: v.Company || null,
        location: v.Location || null,
      },
    });
  }

  for (const s of scans) {
    events.push({
      timestamp: s.ScanTime,
      type: "scan",
      source: { type: "scan", id: String(s._id) },
      snapshot: {
        currentTitle: s.Title || null,
        currentCompany: s.Company || null,
        location: s.Location || null,
      },
    });
  }

  for (const c of changes) {
    events.push({
      timestamp: c.timestamp,
      type: c.type,
      source: { type: "change", id: String(c._id) },
      detail: {
        from: c.from,
        to: c.to,
        tenureDays: c.tenureDaysAtPreviousRole || null,
      },
    });
  }

  // Sort descending by timestamp
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Apply date range filter
  let filtered = events;
  if (from || to) {
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    filtered = events.filter((e) => {
      const ts = new Date(e.timestamp);
      if (fromDate && ts < fromDate) return false;
      if (toDate && ts > toDate) return false;
      return true;
    });
  }

  const totalEvents = filtered.length;
  const dateRange = {
    from: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : null,
    to: filtered.length > 0 ? filtered[0].timestamp : null,
  };

  const paginated = filtered.slice(offset, offset + limit);

  logger.debug("Timeline assembled", {
    personId: String(person._id),
    totalEvents,
    returned: paginated.length,
  });

  return {
    timeline: paginated,
    metadata: { totalEvents, dateRange },
  };
}

module.exports = { getPersonTimeline };
