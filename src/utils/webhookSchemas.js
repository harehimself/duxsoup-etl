/**
 * JSON Schemas for DuxSoup webhook payloads.
 *
 * Used by webhookSchemaValidator.js in warn-only mode to detect
 * schema drift — DuxSoup can change payload shapes without warning.
 * Type violations on known fields are logged as warnings; unknown
 * fields are logged as info (potential new DuxSoup features).
 *
 * Reference: docs/WEBHOOK_PAYLOADS.md
 */

// -- Sub-schemas for extended data (visit-only) --

const positionDateSchema = {
  type: "object",
  properties: {
    month: { type: "integer" },
    year: { type: "integer" },
  },
  additionalProperties: true,
};

const positionSchema = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    companyName: { type: ["string", "null"] },
    companyId: { type: ["string", "integer", "null"] },
    description: { type: ["string", "null"] },
    startDate: { oneOf: [positionDateSchema, { type: "null" }] },
    endDate: { oneOf: [positionDateSchema, { type: "null" }] },
    isCurrent: { type: ["boolean", "null"] },
    location: { type: ["string", "null"] },
  },
  additionalProperties: true,
};

const schoolSchema = {
  type: "object",
  properties: {
    schoolName: { type: ["string", "null"] },
    // DuxSoup sometimes sends rich objects instead of strings (the education bug)
    Name: {},
    degree: { type: ["string", "null"] },
    Degree: {},
    fieldOfStudy: { type: ["string", "null"] },
    Field: {},
    startDate: { oneOf: [positionDateSchema, { type: "null" }] },
    endDate: { oneOf: [positionDateSchema, { type: "null" }] },
  },
  additionalProperties: true,
};

const extendedSchema = {
  type: "object",
  properties: {
    positions: {
      type: "array",
      items: positionSchema,
    },
    schools: {
      type: "array",
      items: schoolSchema,
    },
    skills: {
      type: "array",
      items: { type: ["string", "object"] },
    },
  },
  additionalProperties: true,
};

// -- Known fields for visit data --

const VISIT_KNOWN_FIELDS = [
  "id",
  "VisitTime",
  "Profile",
  "First Name",
  "Last Name",
  "Middle Name",
  "Degree",
  "SalesProfile",
  "RecruiterProfile",
  "Picture",
  "Connections",
  "Summary",
  "Title",
  "From",
  "Company",
  "CompanyProfile",
  "CompanyWebsite",
  "PersonalWebsite",
  "Email",
  "Phone",
  "IM",
  "Twitter",
  "Location",
  "Industry",
  "My Tags",
  "My Notes",
  "extended",
  "Birthday",
  "Thumbnail",
];

const visitDataSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
    VisitTime: { type: ["string", "number"] },
    Profile: { type: ["string", "null"] },
    "First Name": { type: ["string", "null"] },
    "Last Name": { type: ["string", "null"] },
    "Middle Name": { type: ["string", "null"] },
    Degree: { type: ["string", "null"] },
    SalesProfile: { type: ["string", "null"] },
    RecruiterProfile: { type: ["string", "null"] },
    Picture: { type: ["string", "null"] },
    Connections: { type: ["string", "null"] },
    Summary: { type: ["string", "null"] },
    Title: { type: ["string", "null"] },
    From: { type: ["string", "null"] },
    Company: { type: ["string", "null"] },
    CompanyProfile: { type: ["string", "null"] },
    CompanyWebsite: { type: ["string", "null"] },
    PersonalWebsite: { type: ["string", "null"] },
    Email: { type: ["string", "null"] },
    Phone: { type: ["string", "null"] },
    IM: { type: ["string", "null"] },
    Twitter: { type: ["string", "null"] },
    Location: { type: ["string", "null"] },
    Industry: { type: ["string", "null"] },
    "My Tags": { type: ["array", "string", "null"] },
    "My Notes": {}, // Mixed — string, array, or object
    extended: { oneOf: [extendedSchema, { type: "null" }] },
    Birthday: { type: ["string", "null"] },
    Thumbnail: { type: ["string", "null"] },
  },
  additionalProperties: true,
};

// -- Known fields for scan data --

const SCAN_KNOWN_FIELDS = [
  "id",
  "ScanTime",
  "Profile",
  "First Name",
  "Last Name",
  "Middle Name",
  "Company",
  "CompanyID",
  "CompanyProfile",
  "Title",
  "Location",
  "Industry",
  "Connection Degree",
  "Profile URL",
  "PublicProfile",
  "Degree",
  "Picture",
  "Thumbnail",
  "Connections",
  "Summary",
  "SalesProfile",
  "RecruiterProfile",
  "Birthday",
];

const scanDataSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
    ScanTime: { type: ["string", "number"] },
    Profile: { type: ["string", "null"] },
    "First Name": { type: ["string", "null"] },
    "Last Name": { type: ["string", "null"] },
    "Middle Name": { type: ["string", "null"] },
    Company: { type: ["string", "null"] },
    CompanyID: { type: ["string", "integer", "null"] },
    CompanyProfile: { type: ["string", "null"] },
    Title: { type: ["string", "null"] },
    Location: { type: ["string", "null"] },
    Industry: { type: ["string", "null"] },
    "Connection Degree": { type: ["string", "null"] },
    "Profile URL": { type: ["string", "null"] },
    PublicProfile: { type: ["string", "null"] },
    Degree: { type: ["string", "null"] },
    Picture: { type: ["string", "null"] },
    Thumbnail: { type: ["string", "null"] },
    Connections: { type: ["string", "null"] },
    Summary: { type: ["string", "null"] },
    SalesProfile: { type: ["string", "null"] },
    RecruiterProfile: { type: ["string", "null"] },
    Birthday: { type: ["string", "null"] },
  },
  additionalProperties: true,
};

// -- Envelope schema (top-level payload) --

const ENVELOPE_KNOWN_FIELDS = [
  "userid",
  "type",
  "time",
  "id",
  "event",
  "messagecontext",
  "data",
];

const envelopeSchema = {
  type: "object",
  required: ["type", "data"],
  properties: {
    userid: { type: ["string", "null"] },
    type: { type: "string", enum: ["visit", "scan"] },
    time: { type: ["string", "null"] },
    id: { type: ["string", "null"] },
    event: { type: ["string", "null"] },
    messagecontext: { type: ["string", "null"] },
    data: { type: "object" },
  },
  additionalProperties: true,
};

module.exports = {
  envelopeSchema,
  visitDataSchema,
  scanDataSchema,
  ENVELOPE_KNOWN_FIELDS,
  VISIT_KNOWN_FIELDS,
  SCAN_KNOWN_FIELDS,
};
