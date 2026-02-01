/**
 * Realistic webhook fixture data representing the SAME person across
 * different webhook types.
 *
 * Person: Mike Hare
 * - LinkedIn username: mike-hare
 * - Sales Nav ID: ACwAAALwVAIBtest123
 * - DuxSoup PID: pid.mike-hare
 *
 * These fixtures model the exact scenario that caused 9,587 duplicates:
 * a visit with Sales Nav ID and a scan with only a profile URL
 * arriving for the same human but producing different primary identifiers.
 */

/**
 * (a) Visit with Sales Nav ID + profile URL
 */
const visitWithSalesNav = {
  userid: 'user1',
  type: 'visit',
  time: '2024-06-15T10:30:00Z',
  id: 'pid.mike-hare',
  data: {
    id: 'pid.mike-hare',
    Profile: 'https://www.linkedin.com/in/mike-hare',
    SalesProfile:
      'https://www.linkedin.com/sales/lead/ACwAAALwVAIBtest123,NAME_SEARCH,abc1',
    'First Name': 'Mike',
    'Last Name': 'Hare',
    Title: 'Founder & CEO',
    Company: 'DuxSoup',
    Location: 'San Francisco, California, United States',
    VisitTime: '2024-06-15T10:30:00Z',
  },
};

/**
 * (b) Scan with profile URL only (no SalesProfile)
 */
const scanWithProfileOnly = {
  userid: 'user1',
  type: 'scan',
  time: '2024-06-16T08:00:00Z',
  id: 'pid.mike-hare',
  data: {
    id: 'pid.mike-hare',
    Profile: 'https://www.linkedin.com/in/mike-hare',
    // No SalesProfile field
    'First Name': 'Mike',
    'Last Name': 'Hare',
    Title: 'Founder & CEO',
    Company: 'DuxSoup',
    Location: 'San Francisco, California, United States',
    ScanTime: '2024-06-16T08:00:00Z',
  },
};

/**
 * (c) Visit with numeric DuxSoup ID (different person for negative test)
 */
const visitWithNumericId = {
  userid: 'user1',
  type: 'visit',
  time: '2024-06-17T14:00:00Z',
  id: '12345678',
  data: {
    id: '12345678',
    Profile: 'https://www.linkedin.com/in/jane-smith-99887766',
    SalesProfile:
      'https://www.linkedin.com/sales/lead/ACoAAABE0YMBexample456',
    'First Name': 'Jane',
    'Last Name': 'Smith',
    Title: 'VP Engineering',
    Company: 'TechCorp',
    Location: 'New York, New York, United States',
    VisitTime: '2024-06-17T14:00:00Z',
  },
};

/**
 * (d) Scan with DuxSoup pid format
 */
const scanWithDuxsoupPid = {
  userid: 'user1',
  type: 'scan',
  time: '2024-06-18T09:00:00Z',
  id: 'pid.mike-hare',
  data: {
    id: 'pid.mike-hare',
    Profile: 'https://www.linkedin.com/in/mike-hare',
    'First Name': 'Mike',
    'Last Name': 'Hare',
    Title: 'Founder & CEO',
    Company: 'DuxSoup',
    ScanTime: '2024-06-18T09:00:00Z',
  },
};

/**
 * (e) Scan with Sales Nav ID (same person as visitWithSalesNav)
 */
const scanWithSalesNav = {
  userid: 'user1',
  type: 'scan',
  time: '2024-06-19T11:00:00Z',
  id: 'pid.mike-hare',
  data: {
    id: 'pid.mike-hare',
    Profile: 'https://www.linkedin.com/in/mike-hare',
    SalesProfile:
      'https://www.linkedin.com/sales/lead/ACwAAALwVAIBtest123,NAME_SEARCH,xyz9',
    'First Name': 'Mike',
    'Last Name': 'Hare',
    Title: 'Founder & CEO',
    Company: 'DuxSoup',
    ScanTime: '2024-06-19T11:00:00Z',
  },
};

/**
 * (f) Visit with only profile URL (no SalesProfile)
 */
const visitWithProfileOnly = {
  userid: 'user1',
  type: 'visit',
  time: '2024-06-20T16:00:00Z',
  id: 'pid.mike-hare',
  data: {
    id: 'pid.mike-hare',
    Profile: 'https://www.linkedin.com/in/mike-hare',
    // No SalesProfile
    'First Name': 'Mike',
    'Last Name': 'Hare',
    Title: 'Founder & CEO',
    Company: 'DuxSoup',
    VisitTime: '2024-06-20T16:00:00Z',
  },
};

module.exports = {
  visitWithSalesNav,
  scanWithProfileOnly,
  visitWithNumericId,
  scanWithDuxsoupPid,
  scanWithSalesNav,
  visitWithProfileOnly,
};
