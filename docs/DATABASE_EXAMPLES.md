# Database Collection Examples

This document provides realistic example records for each collection in the DuxSoup ETL database, showing the data structure and purpose of each collection.

---

## 1. Scans Collection

**Purpose:** Observation logs of LinkedIn profile scans (append-only event history)

**What it provides:**

- Raw scan data from DuxSoup browser extension
- Point-in-time snapshot of what was scraped
- Source of truth for "what we saw" at scan time
- Used to backfill and update People snapshots

### Example Scan Record

```json
{
  "_id": "67802f4a8b3c2e001f5a1234",

  // DuxSoup identifiers
  "id": "pid.sarah-chen-4567890",
  "ScanTime": "2026-01-05T14:32:18.000Z",

  // Profile URLs (UNSTABLE - can change)
  "Profile": "https://www.linkedin.com/in/sarah-chen-4567890/",
  "Profile URL": "https://www.linkedin.com/in/sarah-chen-4567890",
  "PublicProfile": "https://www.linkedin.com/in/sarah-chen-4567890",
  "SalesProfile": "https://www.linkedin.com/sales/lead/ACwAAAdhR2IBX0vNzKq3eJ2hCd8fMQtUx9hBwYo,NAME_SEARCH,Abc7",

  // Basic profile data
  "First Name": "Sarah",
  "Middle Name": "Michelle",
  "Last Name": "Chen",

  // Current position
  "Title": "Senior Product Manager",
  "Company": "TechFlow Solutions",
  "CompanyID": "2847563", // ← LinkedIn numeric company ID (STABLE)

  // Location and industry
  "Location": "San Francisco Bay Area",
  "Industry": "Computer Software",

  // Connection info
  "Connection Degree": "2nd",
  "Degree": "2nd",
  "Connections": "500+",

  // Profile media
  "Picture": "https://media.licdn.com/dms/image/C4E03AQGxyz123/profile-displayphoto-shrink_800_800/0/1234567890123",

  // About section
  "Summary": "Experienced product leader with 8+ years building enterprise SaaS products. Passionate about user-centered design and data-driven decision making. Former engineer turned PM.",

  // Idempotency & deduplication
  "event_key": "a3f8c2d91e4b5a6c789012345678901234567890",

  // Raw webhook payload (full data as received)
  "rawData": {
    "userid": "duxsoup_user_12345",
    "time": "2026-01-05T14:32:18.000Z",
    "type": "scan",
    "event": "create",
    "data": {
      "id": "pid.sarah-chen-4567890",
      "First Name": "Sarah",
      "Last Name": "Chen"
      // ... full webhook data
    }
  },

  // Timestamps (auto-generated)
  "createdAt": "2026-01-05T14:32:20.123Z",
  "updatedAt": "2026-01-05T14:32:20.123Z"
}
```

**Key characteristics:**

- ✅ Immutable observation log (never modified after creation)
- ✅ Contains point-in-time data exactly as scraped
- ✅ `event_key` prevents duplicate webhook retries
- ✅ `rawData` preserves full webhook payload for audit trail

---

## 2. Visits Collection

**Purpose:** Observation logs of LinkedIn profile visits with extended data (append-only event history)

**What it provides:**

- Rich profile data from DuxSoup visits (includes extended fields)
- Full work history, education, skills from LinkedIn
- More complete than scans (visits scrape deeper)
- Higher priority than scans for updating People snapshots

### Example Visit Record

```json
{
  "_id": "67802f9b8b3c2e001f5a5678",

  // DuxSoup identifiers
  "id": "pid.michael-rodriguez-987654",
  "VisitTime": "2026-01-07T09:15:42.000Z",

  // Profile URLs
  "Profile": "https://www.linkedin.com/in/michael-rodriguez-987654/",
  "SalesProfile": "https://www.linkedin.com/sales/lead/ACwAABjK8PoBZx4nYtR2jLmQw5vXcDuF1pHsGxE,NAME_SEARCH,Xyz9",

  // Basic profile data
  "First Name": "Michael",
  "Last Name": "Rodriguez",

  // Current position
  "Title": "VP of Engineering",
  "From": "2023",
  "Company": "DataCore Inc",
  "CompanyProfile": "https://www.linkedin.com/company/82978333", // ← Contains numeric company ID
  "CompanyWebsite": "https://www.datacore.io",

  // Location and industry
  "Location": "Austin, Texas, United States",
  "Industry": "Information Technology & Services",

  // Connection info
  "Degree": "3rd+",
  "Connections": "500+",

  // Profile media
  "Picture": "https://media.licdn.com/dms/image/D5603AQH8ab456/profile-displayphoto-shrink_800_800/0/1698765432109",

  // Contact information
  "Email": "michael.r@datacore.io",
  "Phone": "+1 (512) 555-0123",
  "Twitter": "@mrodriguez",
  "PersonalWebsite": "https://michaelrodriguez.dev",

  // About section
  "Summary": "Engineering leader with 15+ years experience scaling teams and building distributed systems. Passionate about mentorship and engineering excellence.",

  // Tags and notes (user-added)
  "My Tags": ["Target Account", "Engineering Leader", "Decision Maker"],
  "My Notes": "Met at TechConf 2025. Follow up about partnership opportunities.",

  // Extended profile data (RICH DATA - only in visits!)
  "extended": {
    "positions": [
      {
        "Title": "VP of Engineering",
        "Company": "DataCore Inc",
        "Location": "Austin, Texas",
        "From": "Jan 2023",
        "To": "Present",
        "Description": "Leading engineering team of 45+ engineers across 6 product teams. Responsible for architecture, hiring, and technical strategy."
      },
      {
        "Title": "Director of Engineering",
        "Company": "CloudScale Systems",
        "Location": "San Francisco, CA",
        "From": "Jun 2019",
        "To": "Dec 2022",
        "Description": "Built and scaled platform engineering team from 8 to 30 engineers. Led migration to microservices architecture."
      },
      {
        "Title": "Senior Software Engineer",
        "Company": "StartupXYZ",
        "Location": "San Francisco Bay Area",
        "From": "Mar 2016",
        "To": "May 2019",
        "Description": "Early employee #12. Built core backend services handling 10M+ requests/day."
      }
    ],
    "schools": [
      {
        "Name": "Stanford University",
        "Degree": "Master of Science",
        "Field": "Computer Science",
        "From": "2014",
        "To": "2016"
      },
      {
        "Name": "University of Texas at Austin",
        "Degree": "Bachelor of Science",
        "Field": "Computer Science",
        "From": "2010",
        "To": "2014"
      }
    ],
    "skills": [
      "Distributed Systems",
      "Engineering Leadership",
      "System Architecture",
      "Microservices",
      "Team Building",
      "Python",
      "Go",
      "Kubernetes",
      "AWS"
    ]
  },

  // Webhook metadata
  "userid": "duxsoup_user_12345",
  "time": "2026-01-07T09:15:42.000Z",
  "type": "visit",
  "event": "create",

  // Idempotency
  "event_key": "b7d4e9f2c1a3b5c6d789123456789012345678ab",

  // Raw webhook payload
  "rawData": {
    "userid": "duxsoup_user_12345",
    "time": "2026-01-07T09:15:42.000Z",
    "type": "visit",
    "event": "create",
    "data": {
      // ... full webhook data
    }
  },

  // Timestamps
  "createdAt": "2026-01-07T09:15:45.789Z",
  "updatedAt": "2026-01-07T09:15:45.789Z"
}
```

**Key characteristics:**

- ✅ Contains `extended` field with full work history, education, skills
- ✅ More complete than scans (visits scrape deeper into profile)
- ✅ Includes user-added tags and notes
- ✅ Higher priority than scans when updating People snapshots

---

## 3. People Collection

**Purpose:** Canonical snapshots of unique LinkedIn profiles (one record per person)

**What it provides:**

- Single source of truth for each person's current state
- Consolidated view from all observations (visits + scans)
- Identity resolution via aliases (handles profile URL changes)
- Smart field precedence (visit data beats scan data)
- Historical role timeline (multiple concurrent roles supported)

### Example Person Record

```json
{
  "_id": "ACwAABjK8PoBZx4nYtR2jLmQw5vXcDuF1pHsGxE",

  // Canonical internal UUID (deterministic from Sales Nav ID)
  "canonical_id": "a7b3c9d2-4e8f-5a1b-9c3d-2e7f8a9b1c4d",

  // All known identifiers for this person (prevents duplicates)
  "aliases": [
    {
      "type": "salesNavId",
      "value": "ACwAABjK8PoBZx4nYtR2jLmQw5vXcDuF1pHsGxE",
      "addedAt": "2026-01-07T09:15:45.789Z"
    },
    {
      "type": "linkedInUsername",
      "value": "michael-rodriguez-987654",
      "addedAt": "2026-01-07T09:15:45.789Z"
    },
    {
      "type": "duxsoupId",
      "value": "pid.michael-rodriguez-987654",
      "addedAt": "2026-01-07T09:15:45.789Z"
    },
    {
      "type": "publicUrl",
      "value": "www.linkedin.com/in/michael-rodriguez-987654",
      "addedAt": "2026-01-07T09:15:45.789Z"
    },
    {
      "type": "salesUrl",
      "value": "https://www.linkedin.com/sales/lead/ACwAABjK8PoBZx4nYtR2jLmQw5vXcDuF1pHsGxE,NAME_SEARCH,Xyz9",
      "addedAt": "2026-01-07T09:15:45.789Z"
    }
  ],

  // SNAPSHOT: Current canonical state (consolidated from all observations)
  "snapshot": {
    // Basic info (from most recent visit)
    "firstName": "Michael",
    "middleName": null,
    "lastName": "Rodriguez",
    "fullName": "Michael Rodriguez",

    // Current position (from most recent observation)
    "currentTitle": "VP of Engineering",
    "currentCompany": "DataCore Inc",
    "currentCompanyId": "82978333", // ← Numeric LinkedIn company ID

    // Contact & profile (visit beats scan)
    "location": "Austin, Texas, United States",
    "industry": "Information Technology & Services",
    "connections": "500+",
    "degree": "3rd+",
    "summary": "Engineering leader with 15+ years experience scaling teams and building distributed systems. Passionate about mentorship and engineering excellence.",

    // Contact information (only from visits)
    "email": "michael.r@datacore.io",
    "phone": "+1 (512) 555-0123",
    "twitter": "@mrodriguez",

    // Profile images
    "profilePicture": "https://media.licdn.com/dms/image/D5603AQH8ab456/profile-displayphoto-shrink_800_800/0/1698765432109",
    "thumbnail": "https://media.licdn.com/dms/image/D5603AQH8ab456/profile-displayphoto-shrink_200_200/0/1698765432109",

    // Websites
    "personalWebsite": "https://michaelrodriguez.dev",
    "companyWebsite": "https://www.datacore.io",

    // ROLES TIMELINE (supports multiple concurrent roles)
    "roles": [
      {
        "title": "VP of Engineering",
        "companyId": "82978333", // ← LinkedIn numeric company ID
        "companyName": "DataCore Inc",
        "location": "Austin, Texas",
        "description": "Leading engineering team of 45+ engineers across 6 product teams. Responsible for architecture, hiring, and technical strategy.",
        "startDate": "2023-01-01T00:00:00.000Z",
        "endDate": null,
        "isCurrent": true
      },
      {
        "title": "Director of Engineering",
        "companyId": "1234567",
        "companyName": "CloudScale Systems",
        "location": "San Francisco, CA",
        "description": "Built and scaled platform engineering team from 8 to 30 engineers. Led migration to microservices architecture.",
        "startDate": "2019-06-01T00:00:00.000Z",
        "endDate": "2022-12-31T00:00:00.000Z",
        "isCurrent": false
      },
      {
        "title": "Senior Software Engineer",
        "companyId": "9876543",
        "companyName": "StartupXYZ",
        "location": "San Francisco Bay Area",
        "description": "Early employee #12. Built core backend services handling 10M+ requests/day.",
        "startDate": "2016-03-01T00:00:00.000Z",
        "endDate": "2019-05-31T00:00:00.000Z",
        "isCurrent": false
      }
    ],

    // Education history
    "education": [
      {
        "school": "Stanford University",
        "degree": "Master of Science",
        "field": "Computer Science",
        "startDate": "2014-09-01T00:00:00.000Z",
        "endDate": "2016-06-01T00:00:00.000Z"
      },
      {
        "school": "University of Texas at Austin",
        "degree": "Bachelor of Science",
        "field": "Computer Science",
        "startDate": "2010-09-01T00:00:00.000Z",
        "endDate": "2014-05-01T00:00:00.000Z"
      }
    ],

    // Skills (accumulated from all visits)
    "skills": [
      "Distributed Systems",
      "Engineering Leadership",
      "System Architecture",
      "Microservices",
      "Team Building",
      "Python",
      "Go",
      "Kubernetes",
      "AWS"
    ],

    // PROVENANCE METADATA: Tracks source of each field value
    "_meta": {
      "firstName": {
        "value": "Michael",
        "observedAt": "2026-01-07T09:15:42.000Z",
        "source": "visit",
        "observationId": "67802f9b8b3c2e001f5a5678"
      },
      "currentTitle": {
        "value": "VP of Engineering",
        "observedAt": "2026-01-07T09:15:42.000Z",
        "source": "visit",
        "observationId": "67802f9b8b3c2e001f5a5678"
      }
      // ... metadata for each field
    }
  },

  // References to observation records (for audit trail)
  "observations": {
    "visits": ["67802f9b8b3c2e001f5a5678", "67801a2b3c4d5e6f7a8b9c0d"],
    "scans": ["67800e1f2a3b4c5d6e7f8a9b", "677f9d8e7c6b5a4d3e2f1a0b"]
  },

  // Metadata about observations
  "meta": {
    "lastObservedAt": "2026-01-07T09:15:42.000Z",
    "lastObservation": {
      "type": "visit",
      "id": "67802f9b8b3c2e001f5a5678",
      "observedAt": "2026-01-07T09:15:42.000Z"
    },
    "observationsCount": 4
  },

  // DERIVED METRICS (computed from roles)
  "derived": {
    "avgTenureMonths": 42,
    "yearsAtCurrentCompany": 3.1
  },

  // Timestamps
  "createdAt": "2026-01-02T10:20:30.456Z",
  "updatedAt": "2026-01-07T09:15:45.789Z"
}
```

**Key characteristics:**

- ✅ **One record per person** (canonical snapshot)
- ✅ **Smart precedence**: Visit data overwrites scan data
- ✅ **Identity resolution**: Multiple aliases prevent duplicates when URLs change
- ✅ **Roles timeline**: Supports multiple concurrent roles (e.g., advisor + full-time job)
- ✅ **Provenance tracking**: `_meta` shows source of each field value
- ✅ **Audit trail**: References to all observations (visits + scans)

---

## 4. Companies Collection

**Purpose:** Canonical snapshots of unique companies (one record per company)

**What it provides:**

- Deduplicated company records
- Consolidated view from all observations
- Company profile data and metadata

### Example Company Record

```json
{
  // Numeric LinkedIn company ID (STABLE - never changes)
  // Extracted from CompanyID field or CompanyProfile URL
  "_id": "82978333",

  // Canonical internal UUID
  "canonical_id": "c3d9e8f7-2a1b-4c5d-8e9f-1a2b3c4d5e6f",

  // All known identifiers for this company
  "aliases": [
    {
      "type": "numericId",
      "value": "82978333",
      "addedAt": "2026-01-05T12:00:00.000Z"
    },
    {
      "type": "profileUrl",
      "value": "www.linkedin.com/company/82978333",
      "addedAt": "2026-01-05T12:00:00.000Z"
    },
    {
      "type": "name",
      "value": "DataCore Inc",
      "addedAt": "2026-01-05T12:00:00.000Z"
    }
  ],

  // SNAPSHOT: Current canonical state
  "snapshot": {
    "name": "DataCore Inc",
    "industry": "Computer Software",
    "location": "Austin, Texas",
    "description": "DataCore helps enterprises build real-time data pipelines at scale. Trusted by 500+ companies worldwide.",
    "companyProfileUrl": "https://www.linkedin.com/company/82978333",
    "website": "https://www.datacore.io",
    "employeeCount": "201-500",
    "founded": "2018"
  },

  // References to observations where this company appeared
  "observations": {
    "visits": ["67802f9b8b3c2e001f5a5678", "67801c2d3e4f5a6b7c8d9e0f"],
    "scans": ["67800f1a2b3c4d5e6f7a8b9c", "677f8e7d6c5b4a3d2e1f0a9b"]
  },

  "meta": {
    "lastObservedAt": "2026-01-07T09:15:42.000Z",
    "lastObservation": {
      "type": "visit",
      "id": "67802f9b8b3c2e001f5a5678",
      "observedAt": "2026-01-07T09:15:42.000Z"
    },
    "observationsCount": 47
  },

  "createdAt": "2026-01-02T08:30:15.123Z",
  "updatedAt": "2026-01-07T09:15:45.789Z"
}
```

**Key characteristics:**

- ✅ One record per company (deduplicated)
- ✅ Tracks all observations where company appeared
- ✅ Provides company-level aggregations and insights

---

## 5. Locations Collection

**Purpose:** Canonical snapshots of unique locations (one record per location)

**What it provides:**

- Deduplicated location records
- Normalized location strings
- Location-based aggregations

### Example Location Record

```json
{
  "_id": "austin-texas-united-states",

  // Canonical internal UUID
  "canonical_id": "d8e9f1a2-3b4c-5d6e-9f1a-2b3c4d5e6f7a",

  // All known aliases for this location
  "aliases": [
    {
      "type": "raw",
      "value": "Austin, Texas, United States",
      "addedAt": "2026-01-05T10:00:00.000Z"
    },
    {
      "type": "raw",
      "value": "Austin, TX",
      "addedAt": "2026-01-06T14:30:00.000Z"
    },
    {
      "type": "normalized",
      "value": "Austin, Texas, United States",
      "addedAt": "2026-01-05T10:00:00.000Z"
    }
  ],

  // SNAPSHOT: Current canonical state
  "snapshot": {
    "name": "Austin, Texas, United States",
    "normalized": "Austin, Texas, United States",
    "country": "United States",
    "region": "Texas",
    "city": "Austin"
  },

  // References to observations with this location
  "observations": {
    "visits": ["67802f9b8b3c2e001f5a5678", "67801d3e4f5a6b7c8d9e0f1a"],
    "scans": ["67800a1b2c3d4e5f6a7b8c9d", "677f9e8d7c6b5a4d3e2f1a0b"]
  },

  "meta": {
    "lastObservedAt": "2026-01-07T09:15:42.000Z",
    "lastObservation": {
      "type": "visit",
      "id": "67802f9b8b3c2e001f5a5678",
      "observedAt": "2026-01-07T09:15:42.000Z"
    },
    "observationsCount": 128
  },

  "createdAt": "2026-01-02T06:45:20.987Z",
  "updatedAt": "2026-01-07T09:15:45.789Z"
}
```

**Key characteristics:**

- ✅ One record per unique location
- ✅ Handles location string variations ("Austin, TX" vs "Austin, Texas")
- ✅ Provides location-based aggregations

---

## Collection Relationships

### Observation-Snapshot Pattern

```
┌─────────────────────────────────────────────────────────┐
│                   OBSERVATIONS                          │
│           (Append-Only Event Logs)                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐              ┌──────────┐                │
│  │  Scans   │              │  Visits  │                │
│  │ 24,505   │              │  10,482  │                │
│  │ records  │              │ records  │                │
│  └────┬─────┘              └────┬─────┘                │
│       │                         │                       │
│       │   Consolidated into     │                       │
│       └──────────┬──────────────┘                       │
│                  ▼                                      │
├─────────────────────────────────────────────────────────┤
│                 SNAPSHOTS                               │
│          (Canonical State)                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  People  │  │Companies │  │Locations │             │
│  │  5,266   │  │  2,717   │  │  1,067   │             │
│  │ records  │  │ records  │  │ records  │             │
│  └──────────┘  └──────────┘  └──────────┘             │
│                                                         │
│  One record per unique person/company/location          │
│  Updated from observations (never deleted)              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
DuxSoup Webhook
    ↓
[observationHandler.js]
    ↓
1. Write to Scans/Visits (observation log)
    ↓
2. Extract identifiers using identityMatcher.js
    ↓
3. Upsert to People/Companies/Locations (snapshots)
    ↓
Result: Observation preserved + Canonical snapshot updated
```

---

## Summary: What Each Collection Provides

| Collection    | Purpose             | Records | Key Insight                                                        |
| ------------- | ------------------- | ------- | ------------------------------------------------------------------ |
| **Scans**     | Observation logs    | 24,505  | Point-in-time scan data (basic fields)                             |
| **Visits**    | Observation logs    | 10,482  | Rich visit data (extended fields: work history, education, skills) |
| **People**    | Canonical snapshots | 5,266   | One record per person, consolidated from all observations          |
| **Companies** | Canonical snapshots | 2,717   | One record per company, deduplicated                               |
| **Locations** | Canonical snapshots | 1,067   | One record per location, normalized                                |

### Key Differences

**Scans vs Visits:**

- Scans = Basic profile data (name, title, company, location)
- Visits = Rich data (full work history, education, skills in `extended` field)
- Visits have **higher priority** when updating People snapshots

**Observations vs Snapshots:**

- Observations (Scans/Visits) = Immutable event logs (append-only)
- Snapshots (People/Companies/Locations) = Canonical current state (updated from observations)
- Observations preserve historical data, snapshots provide current truth

---

**Last Updated:** 2026-01-09
**Database:** MongoDB Atlas
**Architecture:** Observation-Snapshot Pattern
