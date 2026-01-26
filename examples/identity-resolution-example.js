/**
 * Identity Resolution Example
 *
 * Demonstrates the complete identity resolution flow:
 * 1. Extract salesNavId from various URL formats
 * 2. Find matching profile with case-insensitive queries
 * 3. Handle username conflicts
 */

const {
  extractSalesNavIdFromUrl,
  extractSalesNavId,
  normalizeToCanonicalCase,
  extractNumericId,
} = require('../src/utils/salesNavIdExtractor');

const {
  findMatchingProfile,
  extractAllIdentifiers,
} = require('../src/utils/profileMatcher');

// ═══════════════════════════════════════════════════════════
// EXAMPLE 1: Extract salesNavId from URLs
// ═══════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('EXAMPLE 1: Extract salesNavId from various URL formats');
console.log('═══════════════════════════════════════════════════════════\n');

const testUrls = [
  // Lowercase, People format with comma params
  'www.linkedin.com/sales/people/acoaaa0cm4mbva7a2z-_ulwwoo2swdf5ye_nv2e,name,o7fk',

  // Lowercase, Lead format with different params
  'www.linkedin.com/sales/lead/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya,name_search,z1jy',

  // Mixed case, Lead format with uppercase params
  'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY',

  // Recruiter format
  'https://www.linkedin.com/talent/profile/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA',

  // Public URL with salesNavId
  'www.linkedin.com/in/acwaaa0cm4mba9l9zimkopy1otohmypitrlogya',
];

testUrls.forEach((url, index) => {
  const salesNavId = extractSalesNavIdFromUrl(url);
  const canonical = salesNavId ? normalizeToCanonicalCase(salesNavId) : null;

  console.log(`URL ${index + 1}:`);
  console.log(`  Input:      ${url}`);
  console.log(`  Extracted:  ${salesNavId || 'null'}`);
  console.log(`  Canonical:  ${canonical || 'null'}`);
  console.log('');
});

// ═══════════════════════════════════════════════════════════
// EXAMPLE 2: Extract from webhook data
// ═══════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('EXAMPLE 2: Extract identifiers from webhook data');
console.log('═══════════════════════════════════════════════════════════\n');

const webhookData = {
  id: 'id.218248067',
  SalesProfile:
    'https://www.linkedin.com/sales/lead/ACwAAA0CM4MBa9l9ZiMKoPY1oTohmYpITrloGYA,NAME_SEARCH,Z1JY',
  Profile: 'www.linkedin.com/in/kayleighhogan',
  PublicProfile: 'https://www.linkedin.com/in/kayleighhogan',
  'First Name': 'Kayleigh',
  'Last Name': 'Hogan',
  Title: 'Senior Product Manager',
  Company: 'TechFlow Solutions',
};

console.log('Webhook Data:');
console.log(JSON.stringify(webhookData, null, 2));
console.log('\nExtracted Identifiers:');

const salesNavId = extractSalesNavId(webhookData);
console.log(`  salesNavId:        ${salesNavId || 'null'}`);

const numericId = extractNumericId(webhookData.id);
console.log(`  numericId:         ${numericId || 'null'}`);

const duxsoupId = webhookData.id;
console.log(`  duxsoupId:         ${duxsoupId || 'null'}`);

const allIdentifiers = extractAllIdentifiers(webhookData);
console.log(`\n  All Aliases (${allIdentifiers.length}):`);
allIdentifiers.forEach((alias) => {
  console.log(`    - ${alias.type}: ${alias.value}`);
});

// ═══════════════════════════════════════════════════════════
// EXAMPLE 3: Matching scenarios (requires DB connection)
// ═══════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════');
console.log('EXAMPLE 3: Profile matching scenarios');
console.log('═══════════════════════════════════════════════════════════\n');

// This would be used in actual code with a DB connection
const exampleMatchingLogic = `
// Scenario 1: Exact salesNavId match
const data1 = {
  SalesProfile: 'www.linkedin.com/sales/lead/ACwAAA123,NAME_SEARCH,Z1JY'
};
const result1 = await findMatchingProfile(data1);
// → { match: true, matchType: 'salesNavId', priority: 1 }

// Scenario 2: Case-insensitive match (lowercase URL, uppercase DB)
const data2 = {
  salesUrl: 'www.linkedin.com/sales/people/acwaaa123,name,o7fk'
};
const result2 = await findMatchingProfile(data2);
// → { match: true, matchType: 'salesNavId', priority: 1 }
//   (Matches DB record with "ACwAAA123")

// Scenario 3: Username match (no ID conflict)
const data3 = {
  Profile: 'www.linkedin.com/in/johndoe'
};
const result3 = await findMatchingProfile(data3);
// → { match: true, matchType: 'linkedInUsername', priority: 3 }

// Scenario 4: Username conflict (different salesNavIds)
const data4 = {
  Profile: 'www.linkedin.com/in/johndoe',
  SalesProfile: 'www.linkedin.com/sales/lead/ACwAAA999'
};
const result4 = await findMatchingProfile(data4);
// → { match: false, reason: 'username_conflict', conflict: { ... } }

// Scenario 5: No match found
const data5 = {
  SalesProfile: 'www.linkedin.com/sales/lead/ACwAAA_NEW'
};
const result5 = await findMatchingProfile(data5);
// → { match: false, reason: 'no_stable_id_match' }
`;

console.log(exampleMatchingLogic);

// ═══════════════════════════════════════════════════════════
// EXAMPLE 4: Priority demonstration
// ═══════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('EXAMPLE 4: Priority order demonstration');
console.log('═══════════════════════════════════════════════════════════\n');

const priorityExample = `
Priority Flow (Highest to Lowest):

┌────────────────────────────────────────────────┐
│ 1. salesNavId (ACwAAA/ACoAAA...)              │
│    - Immutable LinkedIn anchor                 │
│    - Case-insensitive DB query                 │
│    - Extracts from: salesUrl, recruiterUrl,    │
│      profileUrl, SalesProfile, etc.            │
└────────────────────────────────────────────────┘
                     ↓ (no match)
┌────────────────────────────────────────────────┐
│ 2. duxsoupId / numericId                       │
│    - Unique per user                           │
│    - Format: "id.218248067" or "pid.username"  │
│    - Extracts numeric ID when available        │
└────────────────────────────────────────────────┘
                     ↓ (no match)
┌────────────────────────────────────────────────┐
│ 3. linkedInUsername                            │
│    - Stable but mutable                        │
│    - ⚠️  CONFLICT DETECTION:                   │
│      If username matches but salesNavId        │
│      differs → DO NOT MERGE (username recycle) │
└────────────────────────────────────────────────┘
                     ↓ (no match)
┌────────────────────────────────────────────────┐
│ 4. URL-based fallback                          │
│    - profileUrl, publicUrl                     │
│    - Least stable (usernames can change)       │
└────────────────────────────────────────────────┘
`;

console.log(priorityExample);

// ═══════════════════════════════════════════════════════════
// EXAMPLE 5: Real-world integration
// ═══════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('EXAMPLE 5: Real-world integration pattern');
console.log('═══════════════════════════════════════════════════════════\n');

const integrationExample = `
// In your webhook handler or ETL process:

async function processLinkedInWebhook(webhookData) {
  // Step 1: Extract all identifiers
  const identifiers = extractAllIdentifiers(webhookData);

  // Step 2: Find or create person
  const matchResult = await findMatchingProfile(webhookData);

  if (matchResult.match) {
    // Found existing person
    const person = matchResult.person;

    console.log(\`Found existing person: \${person._id}\`);
    console.log(\`Matched by: \${matchResult.matchType}\`);

    // Update snapshot with new observation data
    await updatePersonSnapshot(person, webhookData);

  } else if (matchResult.reason === 'username_conflict') {
    // Username collision - these are DIFFERENT people
    console.warn('Username conflict detected:', matchResult.conflict);

    // Create new person (don't merge)
    const newPerson = await Person.create({
      _id: generateNewId(),
      aliases: identifiers,
      snapshot: buildSnapshot(webhookData),
    });

    console.log(\`Created new person due to conflict: \${newPerson._id}\`);

  } else {
    // No match - create new person
    const salesNavId = extractSalesNavId(webhookData);
    const personId = salesNavId || generateFallbackId(webhookData);

    const newPerson = await Person.create({
      _id: personId,
      canonical_id: computeCanonicalId(personId),
      aliases: identifiers,
      snapshot: buildSnapshot(webhookData),
      observations: { visits: [], scans: [] },
    });

    console.log(\`Created new person: \${newPerson._id}\`);
  }
}
`;

console.log(integrationExample);

console.log('═══════════════════════════════════════════════════════════');
console.log('For complete implementation details, see:');
console.log('  - docs/IDENTITY_RESOLUTION_IMPLEMENTATION.md');
console.log('  - src/utils/salesNavIdExtractor.js');
console.log('  - src/utils/profileMatcher.js');
console.log('═══════════════════════════════════════════════════════════');
