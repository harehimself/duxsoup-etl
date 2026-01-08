/**
 * Webhook Field Names Constants
 *
 * Centralized definitions for DuxSoup webhook field names.
 * These fields use specific casing (some with spaces/quotes) as provided by DuxSoup.
 */

/**
 * Common fields across all webhook types
 */
const COMMON_FIELDS = {
  ID: 'id',
  PROFILE: 'Profile',
  FIRST_NAME: 'First Name',
  LAST_NAME: 'Last Name',
  MIDDLE_NAME: 'Middle Name',
  DEGREE: 'Degree',
  PICTURE: 'Picture',
  CONNECTIONS: 'Connections',
  SUMMARY: 'Summary',
  TITLE: 'Title',
  COMPANY: 'Company',
  COMPANY_PROFILE: 'CompanyProfile',
  COMPANY_WEBSITE: 'CompanyWebsite',
  LOCATION: 'Location',
  INDUSTRY: 'Industry',
  SALES_PROFILE: 'SalesProfile',
  RECRUITER_PROFILE: 'RecruiterProfile',
};

/**
 * Visit-specific fields
 */
const VISIT_FIELDS = {
  VISIT_TIME: 'VisitTime',
  FROM: 'From',
  PERSONAL_WEBSITE: 'PersonalWebsite',
  EMAIL: 'Email',
  PHONE: 'Phone',
  IM: 'IM',
  TWITTER: 'Twitter',
  MY_TAGS: 'My Tags',
  EXTENDED: 'extended',
  MY_NOTES: 'My Notes',
};

/**
 * Scan-specific fields
 */
const SCAN_FIELDS = {
  SCAN_TIME: 'ScanTime',
  COMPANY_ID: 'CompanyID',
  CONNECTION_DEGREE: 'Connection Degree',
  PROFILE_URL: 'Profile URL',
  PUBLIC_PROFILE: 'PublicProfile',
  THUMBNAIL: 'Thumbnail',
};

/**
 * Top-level payload metadata fields
 */
const METADATA_FIELDS = {
  USERID: 'userid',
  TIME: 'time',
  TYPE: 'type',
  EVENT: 'event',
  MESSAGE_CONTEXT: 'messagecontext',
};

/**
 * Get all field names for a specific webhook type
 * @param {string} type - 'visit' or 'scan'
 * @returns {Object} Combined field names object
 */
function getFieldsForType(type) {
  if (type === 'visit') {
    return { ...COMMON_FIELDS, ...VISIT_FIELDS, ...METADATA_FIELDS };
  } else if (type === 'scan') {
    return { ...COMMON_FIELDS, ...SCAN_FIELDS, ...METADATA_FIELDS };
  }
  return COMMON_FIELDS;
}

module.exports = {
  COMMON_FIELDS,
  VISIT_FIELDS,
  SCAN_FIELDS,
  METADATA_FIELDS,
  getFieldsForType,
};
