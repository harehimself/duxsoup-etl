# Webhook Payload Reference

> Canonical reference for DuxSoup webhook field differences between visit and scan payloads.
>
> **Source of truth:** This document is derived from actual source code in `src/controllers/`, `src/models/`, and `src/utils/`.

---

## 1. Payload Envelope

Every DuxSoup webhook arrives as an HTTP POST with the following top-level structure:

```json
{
  "userid": "duxsoup-user-id",
  "type": "visit",
  "time": "2026-01-15T14:30:00.000Z",
  "id": "pid.mike-hare",
  "event": "create",
  "messagecontext": "",
  "data": {
    "id": "pid.mike-hare",
    "Profile": "https://www.linkedin.com/in/mike-hare",
    "First Name": "Mike",
    ...
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `userid` | String | DuxSoup user account that triggered the event |
| `type` | String | Event type: `"visit"` or `"scan"` |
| `time` | String (ISO 8601) | Timestamp when DuxSoup created the event |
| `id` | String | DuxSoup profile identifier (see [Section 5: Identity Fields](#5-identity-fields)) |
| `event` | String | Event stage, typically `"create"` or `"update"` |
| `messagecontext` | String | Message context identifier (often empty) |
| `data` | Object | The profile data payload — all person fields live here |

The ETL system reads `data` as `profileData` after validation. The `userid`, `type`, `time`, `event`, and `messagecontext` fields are stored as metadata on the observation document.

### Idempotency Key

An `event_key` is computed from the envelope fields: `SHA1(userid | type | time | id)`. This prevents duplicate observation records when DuxSoup retries a webhook. See `src/utils/eventKey.js`.

---

## 2. Visit Fields

Extracted from `mapVisitData()` in `src/controllers/visitController.js` and the Visit schema in `src/models/visit.js`.

**Required fields** (validated before processing): `VisitTime`, `Degree`, `First Name`

| Field | Schema Type | Required | Source | Example | Notes |
|-------|-------------|----------|--------|---------|-------|
| `id` | String | Yes | `data.id` | `"pid.mike-hare"` | DuxSoup profile identifier. Custom validator: non-empty string. |
| `VisitTime` | Date | Yes | `data.VisitTime` | `"2026-01-15T14:30:00.000Z"` | Timestamp of the visit event |
| `Profile` | String | No | `data.Profile` | `"https://www.linkedin.com/in/mike-hare"` | LinkedIn profile URL (unstable, not used for identity) |
| `First Name` | String | Yes | `data["First Name"]` | `"Mike"` | |
| `Last Name` | String | No | `data["Last Name"]` | `"Hare"` | Defaults to `""` if absent |
| `Middle Name` | String | No | `data["Middle Name"]` | `"James"` | Defaults to `""` |
| `Degree` | String | Yes | `data.Degree` | `"1st"` | Connection degree (1st, 2nd, 3rd) |
| `SalesProfile` | String | No | `data.SalesProfile` | `"https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ"` | Sales Navigator URL — **primary source of Sales Nav IDs** |
| `RecruiterProfile` | String | No | `data.RecruiterProfile` | `"https://www.linkedin.com/recruiter/profile/ACwAAALwVAIB..."` | Recruiter platform URL |
| `Picture` | String | No | `data.Picture` | `"https://media.licdn.com/dms/image/..."` | Profile photo URL |
| `Connections` | String | No | `data.Connections` | `"500+"` | Connection count as string |
| `Summary` | String | No | `data.Summary` | `"Experienced product leader..."` | LinkedIn headline/about summary |
| `Title` | String | No | `data.Title` | `"VP of Product"` | Current job title |
| `From` | String | No | `data.From` | `"Jan 2020"` | Start date of current role |
| `Company` | String | No | `data.Company` | `"Acme Corp"` | Current company name |
| `CompanyProfile` | String | No | `data.CompanyProfile` | `"https://www.linkedin.com/company/acme-corp"` | Company LinkedIn page URL |
| `CompanyWebsite` | String | No | `data.CompanyWebsite` | `"https://www.acmecorp.com"` | Company external website |
| `PersonalWebsite` | String | No | `data.PersonalWebsite` | `"https://mikehare.com"` | Personal website URL |
| `Email` | String | No | `data.Email` | `"mike@acmecorp.com"` | Email if visible on profile |
| `Phone` | String | No | `data.Phone` | `"+1-555-123-4567"` | Phone if visible on profile |
| `IM` | String | No | `data.IM` | `"mike.hare"` | Instant messaging handle |
| `Twitter` | String | No | `data.Twitter` | `"@mikehare"` | Twitter/X handle |
| `Location` | String | No | `data.Location` | `"San Francisco, California, United States"` | Raw location string |
| `Industry` | String | No | `data.Industry` | `"Computer Software"` | LinkedIn industry classification |
| `My Tags` | [String] | No | `data["My Tags"]` | `["prospect", "follow-up"]` | DuxSoup user-defined tags |
| `My Notes` | Mixed | No | `data["My Notes"]` | `"Met at SaaStr conference"` | DuxSoup user-defined notes (can be String or Array) |
| `extended` | Mixed | No | `data.extended` | See [Section 6](#6-extended-data) | Nested positions, schools, skills |
| `Birthday` | String | No | — | `"January 15"` | In schema but not mapped by dataMapper |

### Structured Location Fields (Parsed)

These are derived by the ETL from the `Location` string via `parseLocation()` — they do not come from the webhook directly:

| Field | Type | Example |
|-------|------|---------|
| `city` | String (max 100) | `"San Francisco"` |
| `state` | String (max 100) | `"California"` |
| `stateCode` | String (max 10) | `"CA"` |
| `country` | String (max 100) | `"United States"` |
| `countryCode` | String (max 10) | `"US"` |
| `province` | String (max 100) | `"British Columbia"` |
| `region` | String (max 100) | `"Bay Area"` |
| `locationType` | String (max 50) | `"metro"` or `"city"` |

### Visit Metadata Fields (from envelope)

| Field | Type | Source |
|-------|------|--------|
| `userid` | String | `payload.userid` |
| `time` | Date | `payload.time` |
| `type` | String | `payload.type` |
| `event` | String | `payload.event` |
| `messagecontext` | String | `payload.messagecontext` |
| `rawData` | Mixed | Full original `payload` (max 1MB) |
| `event_key` | String | Computed SHA1 idempotency key (unique, sparse index) |

---

## 3. Scan Fields

Extracted from `mapScanData()` in `src/controllers/scanController.js` and the Scan schema in `src/models/scan.js`.

**Required fields** (validated before processing): `ScanTime`, `First Name`, `Last Name`

| Field | Schema Type | Required | Source | Example | Notes |
|-------|-------------|----------|--------|---------|-------|
| `id` | String | Yes | `data.id` | `"pid.mike-hare"` | DuxSoup profile identifier |
| `ScanTime` | Date | Yes | `data.ScanTime` | `"2026-01-15T14:30:00.000Z"` | Timestamp of the scan event |
| `Profile` | String | No | `data.Profile` | `"https://www.linkedin.com/in/mike-hare"` | LinkedIn profile URL |
| `First Name` | String | Yes | `data["First Name"]` | `"Mike"` | |
| `Last Name` | String | Yes | `data["Last Name"]` | `"Hare"` | **Required for scans** (optional for visits) |
| `Middle Name` | String | No | `data["Middle Name"]` | `"James"` | |
| `Company` | String | No | `data.Company` | `"Acme Corp"` | |
| `CompanyID` | String | No | `data.CompanyID` | `"12345678"` | **Scan-only field** — numeric LinkedIn company ID |
| `CompanyProfile` | String | No | `data.CompanyProfile` | `"https://www.linkedin.com/company/acme-corp"` | |
| `Title` | String | No | `data.Title` | `"VP of Product"` | |
| `Location` | String | No | `data.Location` | `"San Francisco, California, United States"` | |
| `Industry` | String | No | `data.Industry` | `"Computer Software"` | |
| `Connection Degree` | String | No | `data["Connection Degree"]` | `"2nd"` | **Scan-only field** — replaces visit's `Degree` |
| `Profile URL` | String | No | `data["Profile URL"]` | `"https://www.linkedin.com/in/mike-hare"` | **Scan-only field** — alternate profile URL |
| `PublicProfile` | String | No | `data.PublicProfile` | `"https://www.linkedin.com/in/mike-hare"` | **Scan-only field** — public-facing profile URL |
| `Degree` | String | No | `data.Degree` | `"2nd"` | Present but **not required** (unlike visits) |
| `Picture` | String | No | `data.Picture` or `data.Thumbnail` | `"https://media.licdn.com/dms/image/..."` | Falls back to `Thumbnail` field |
| `Connections` | String | No | `data.Connections` | `"500+"` | |
| `Summary` | String | No | `data.Summary` | `"Experienced product leader..."` | |
| `SalesProfile` | String | No | `data.SalesProfile` | — | **Rarely present in scans** (see [Section 4](#4-url-fields)) |
| `RecruiterProfile` | String | No | `data.RecruiterProfile` | — | |
| `Birthday` | String | No | — | `"January 15"` | In schema but not mapped by dataMapper |
| `rawData` | Mixed | No | Full `payload` | — | Max 1MB |
| `event_key` | String | No | Computed SHA1 | — | Unique, sparse index |

### Structured Location Fields (Parsed)

Same as visits — derived from the `Location` string, not from the webhook.

### Key Differences: Scan vs Visit

| Aspect | Visit | Scan |
|--------|-------|------|
| Time field | `VisitTime` | `ScanTime` |
| `Last Name` | Optional | **Required** |
| `Degree` | **Required** | Optional |
| `CompanyID` | Not present | Present (numeric company ID) |
| `Connection Degree` | Not present | Present |
| `Profile URL` | Not present | Present |
| `PublicProfile` | Not present | Present |
| `From` | Present (role start date) | Not present |
| `CompanyWebsite` | Present | Not present |
| `PersonalWebsite` | Present | Not present |
| `Email` | Present | Not present |
| `Phone` | Present | Not present |
| `IM` | Present | Not present |
| `Twitter` | Present | Not present |
| `My Tags` | Present | Not present |
| `My Notes` | Present | Not present |
| `extended` | Present (positions, schools, skills) | Not present |
| `Picture` fallback | `data.Picture` only | `data.Picture` or `data.Thumbnail` |
| Metadata fields | `userid`, `time`, `type`, `event`, `messagecontext` | Not mapped by dataMapper |

---

## 4. URL Fields

DuxSoup webhooks can contain several URL fields that reference the same person's LinkedIn presence. Each carries different identity signals.

### Profile

- **Field:** `Profile`
- **Present in:** Both visits and scans
- **Format:** `https://www.linkedin.com/in/<username>` (public profile)
- **Example:** `https://www.linkedin.com/in/mike-hare`
- **Identity use:** Extracts LinkedIn username via `/in/<username>` pattern. Used as a fallback identifier. **URLs are unstable** — LinkedIn can change usernames.

### SalesProfile

- **Field:** `SalesProfile`
- **Present in:** Visits (common), Scans (rare/absent)
- **Format:** `https://www.linkedin.com/sales/lead/<SalesNavID>,NAME,<params>`
- **Example:** `https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME,o7fk`
- **Identity use:** Extracts the Sales Navigator ID (`ACwAAA...` or `ACoAAA...` prefix). This is the **most stable identifier** — it never changes for a given person.
- **Critical note:** SalesProfile is the primary source of Sales Nav IDs. Because scans rarely include this field, a scan for the same person may lack the Sales Nav ID entirely. **This is the root cause of the duplicate person problem** — a visit creates a person keyed by Sales Nav ID, then a scan for the same human arrives without a SalesProfile, cannot match the existing person, and creates a duplicate.

### PublicProfile

- **Field:** `PublicProfile`
- **Present in:** Scans only
- **Format:** `https://www.linkedin.com/in/<username>` or `https://www.linkedin.com/pub/<slug>`
- **Example:** `https://www.linkedin.com/in/mike-hare`
- **Identity use:** Extracts username or public profile slug. Normalized to `linkedin.com/in/<username>` or `linkedin.com/pub/<slug>`.

### RecruiterProfile

- **Field:** `RecruiterProfile`
- **Present in:** Both visits and scans (when available)
- **Format:** `https://www.linkedin.com/recruiter/profile/<ID>`
- **Example:** `https://www.linkedin.com/recruiter/profile/ACwAAALwVAIB,name,abc`
- **Identity use:** Can contain a Sales Nav ID-like identifier. Checked as a last resort for username extraction.

### CompanyProfile

- **Field:** `CompanyProfile`
- **Present in:** Both visits and scans
- **Format:** `https://www.linkedin.com/company/<company-slug>` or `https://www.linkedin.com/company/<numeric-id>`
- **Example:** `https://www.linkedin.com/company/acme-corp`
- **Identity use:** Used to resolve company identity. Numeric IDs in the URL are extracted for company matching.

### Profile URL (scan only)

- **Field:** `Profile URL`
- **Present in:** Scans only
- **Format:** Same as `Profile` — `https://www.linkedin.com/in/<username>`
- **Identity use:** Redundant with `Profile` in most cases. Checked during identity resolution.

---

## 5. Identity Fields

### The `id` Field (DuxSoup ID)

The `id` field inside `data` is assigned by DuxSoup and has two common formats:

| Format | Pattern | Example | Stability |
|--------|---------|---------|-----------|
| `pid.<username>` | `pid.` prefix + LinkedIn username | `pid.mike-hare` | Tied to username (can change) |
| Numeric | 8+ digit number | `49382716` | LinkedIn member ID (stable, immutable) |

The `extractNumericId()` function in `salesNavIdExtractor.js` checks if a DuxSoup ID is purely numeric (8+ digits) and treats it as a LinkedIn member ID.

The `extractLinkedInUsername()` function in `identityMatcher.js` strips the `pid.` prefix to extract the bare username.

### Identity Extraction Priority

The `extractIdentifiers()` function in `identityMatcher.js` extracts all available identifiers from a webhook payload:

| Priority | Identifier | Source Fields | Description |
|----------|-----------|---------------|-------------|
| 1 | `salesNavId` | `SalesProfile`, `RecruiterProfile`, `Profile` | `ACwAAA...` or `ACoAAA...` prefix. Most stable. |
| 2 | `numericId` | `data.id` | Pure numeric DuxSoup ID (8+ digits = LinkedIn member ID) |
| 3 | `linkedInUsername` | `data.id` (pid format), `Profile`, `PublicProfile`, `SalesProfile`, `RecruiterProfile` | Username from `/in/<username>` pattern |
| 4 | `vanityName` | `Profile`, `PublicProfile` | Same as username but extracted via separate function |
| 5 | `profileUrl` | `Profile` | Normalized full profile URL |
| 6 | `publicProfile` | `PublicProfile`, `Profile` | Normalized to `linkedin.com/in/<username>` |
| 7 | `recruiterProfile` | `RecruiterProfile` | Normalized recruiter URL |
| 8 | `duxsoupId` | `data.id` | Raw DuxSoup ID (least stable) |

### Why Visits and Scans Produce Different Identifiers

| Identifier | Visit | Scan | Impact |
|-----------|-------|------|--------|
| `salesNavId` | Usually available (via `SalesProfile`) | Rarely available | Scans often cannot match visit-created people |
| `numericId` | Sometimes (numeric `data.id`) | Sometimes | Depends on DuxSoup ID format |
| `linkedInUsername` | Available (via `Profile` or `pid.` ID) | Available (via `Profile`, `PublicProfile`, or `pid.` ID) | Common ground for cross-matching |
| `vanityName` | Available (via `Profile`) | Available (via `Profile`, `PublicProfile`) | Mirrors `linkedInUsername` |

The `linkedInUsername` / `vanityName` is the critical bridge between visit and scan identifiers. When a visit creates a person with a Sales Nav ID, the username alias enables a subsequent scan (which lacks the Sales Nav ID) to find and update the same person instead of creating a duplicate.

---

## 6. Extended Data

The `extended` field is a Mixed (schemaless) object that carries rich profile data. It is **present in visits** but **absent in scans**.

### extended.positions

Array of employment history records.

```json
{
  "extended": {
    "positions": [
      {
        "title": "VP of Product",
        "companyName": "Acme Corp",
        "companyId": "12345678",
        "description": "Leading product strategy...",
        "startDate": { "month": 3, "year": 2022 },
        "endDate": null,
        "isCurrent": true,
        "location": "San Francisco, CA"
      },
      {
        "title": "Senior Product Manager",
        "companyName": "Previous Inc",
        "companyId": "87654321",
        "description": "",
        "startDate": { "month": 6, "year": 2019 },
        "endDate": { "month": 2, "year": 2022 },
        "isCurrent": false,
        "location": "New York, NY"
      }
    ]
  }
}
```

Fields per position: `title`, `companyName`, `companyId`, `description`, `startDate` (`{ month, year }`), `endDate` (`{ month, year }` or `null`), `isCurrent`, `location`.

### extended.schools

Array of education records.

```json
{
  "extended": {
    "schools": [
      {
        "schoolName": "Stanford University",
        "degree": "MBA",
        "fieldOfStudy": "Business Administration",
        "startDate": { "year": 2015 },
        "endDate": { "year": 2017 }
      }
    ]
  }
}
```

Fields per school: `schoolName`, `degree`, `fieldOfStudy`, `startDate` (`{ year }`), `endDate` (`{ year }`).

### extended.skills

Array of skill strings.

```json
{
  "extended": {
    "skills": [
      "Product Management",
      "Strategic Planning",
      "SaaS",
      "Team Leadership"
    ]
  }
}
```

### Availability by Webhook Type

| Data | Visit | Scan |
|------|-------|------|
| `extended.positions` | Yes (full employment history) | No |
| `extended.schools` | Yes (education history) | No |
| `extended.skills` | Yes (skills list) | No |

Scans produce a surface-level snapshot (name, title, company, location) without the rich employment/education/skills data that visits provide. This is why the system gives visits higher precedence than scans when updating person snapshots.
