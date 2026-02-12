# DuxSoup ETL — Field Reference

> Comprehensive data dictionary for all fields extracted by DuxSoup, organized by extraction type, connection degree, and pipeline stage.

**Last Updated:** 2026-01-30

---

## Table of Contents

1. [Extraction Types Overview](#1-extraction-types-overview)
2. [Field Availability Matrix](#2-field-availability-matrix)
3. [Connection Degree Impact](#3-connection-degree-impact)
4. [Webhook Payload Structure](#4-webhook-payload-structure)
5. [Field Definitions — Observation Layer](#5-field-definitions--observation-layer)
6. [Field Definitions — Extended Data (Visits Only)](#6-field-definitions--extended-data-visits-only)
7. [Field Definitions — Person Snapshot](#7-field-definitions--person-snapshot)
8. [Field Definitions — Company Snapshot](#8-field-definitions--company-snapshot)
9. [Field Definitions — Location Snapshot](#9-field-definitions--location-snapshot)
10. [Field Flow: Webhook to Snapshot](#10-field-flow-webhook-to-snapshot)
11. [Identity Resolution Fields](#11-identity-resolution-fields)
12. [Derived & Enriched Fields](#12-derived--enriched-fields)
13. [Fields NOT Currently Captured](#13-fields-not-currently-captured)

---

## 1. Extraction Types Overview

DuxSoup produces four distinct extraction types, each delivering a different mix of data:

| Extraction Type | Platform | DuxSoup Action | `type` value | Time Field | Depth |
|---|---|---|---|---|---|
| **Scan on LinkedIn** | linkedin.com | Background profile scan | `scan` | `ScanTime` | Basic |
| **Scan on Sales Navigator** | linkedin.com/sales | Background profile scan | `scan` | `ScanTime` | Basic + Sales Nav IDs |
| **Visit on LinkedIn** | linkedin.com | Active profile visit | `visit` | `VisitTime` | Rich (includes `extended`) |
| **Visit on Sales Navigator** | linkedin.com/sales | Active profile visit | `visit` | `VisitTime` | Rich (includes `extended`) + Sales Nav IDs |

### Key Differences

- **Scans** are passive — DuxSoup reads data from search results and list views without visiting the profile. Faster, but shallower data.
- **Visits** are active — DuxSoup navigates to the profile page and scrapes the full profile. Slower, but captures work history, education, skills, contact info, and summary.
- **Sales Navigator** provides additional stable identifiers (Sales Nav IDs) and sometimes the `CompanyID` field that regular LinkedIn does not.
- **LinkedIn** provides `Profile URL`, `PublicProfile`, and sometimes `Connection Degree` fields that Sales Navigator may format differently.

---

## 2. Field Availability Matrix

Legend:
- **A** = Always present (required/reliable)
- **C** = Common (usually present)
- **R** = Rare (present for some profiles/connections)
- **N** = Never (not available for this extraction type)
- **1st** = Only for 1st-degree connections
- **Dep** = Depends on connection degree (see Section 3)

### Core Identity Fields

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `id` | A | A | A | A | DuxSoup internal ID. Format: `pid.<username>` |
| `Profile` | C | C | C | C | LinkedIn profile URL (unstable, can change) |
| `Profile URL` | C | R | N | N | Scan-specific duplicate of Profile |
| `PublicProfile` | C | R | N | N | Scan-specific public profile URL |
| `SalesProfile` | R | A | R | A | Sales Navigator profile URL. Contains Sales Nav ID |
| `RecruiterProfile` | R | R | R | R | Recruiter profile URL |

### Basic Profile Fields

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `First Name` | A | A | A | A | **Required** for both scan and visit |
| `Last Name` | A | A | C | C | **Required** for scan; not required for visit |
| `Middle Name` | R | R | R | R | Rarely populated |
| `Picture` | C | C | C | C | Profile photo URL (CDN link, may expire) |
| `Connections` | C | C | C | C | String: `"500+"`, `"1234"`, etc. |
| `Degree` | C | C | A | A | Connection degree: `"1st"`, `"2nd"`, `"3rd+"`. **Required** for visit |
| `Connection Degree` | C | C | N | N | Scan-specific version of Degree |
| `Summary` | Dep | Dep | Dep | Dep | About/bio section. See degree impact |
| `Birthday` | R | R | R | R | Only for 1st-degree; format varies |

### Position & Company Fields

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `Title` | C | C | C | C | Current job title (headline may differ) |
| `Company` | C | C | C | C | Current company name |
| `CompanyID` | R | C | N | N | Numeric LinkedIn company ID (**scan-only**, stable) |
| `CompanyProfile` | R | R | C | C | Company LinkedIn URL. Contains company numeric ID |
| `CompanyWebsite` | N | N | Dep | Dep | Company website (**visit-only**) |
| `From` | N | N | C | C | Start year/date at current position (**visit-only**) |
| `Industry` | C | C | C | C | Industry string (free text, not standardized) |

### Contact Fields (Visit-Only, Degree-Dependent)

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `Email` | N | N | 1st | 1st | Only visible for 1st-degree connections |
| `Phone` | N | N | 1st | 1st | Only visible for 1st-degree connections |
| `IM` | N | N | 1st | 1st | Instant messaging handles (Skype, etc.) |
| `Twitter` | N | N | 1st | 1st | Twitter/X handle |
| `PersonalWebsite` | N | N | 1st | 1st | Personal website URL |

### Location Fields

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `Location` | C | C | C | C | Free-text location string (e.g., `"San Francisco Bay Area"`) |

> Location is parsed into structured subfields by `location-parser.js` during ingestion. See Section 5 for parsed fields.

### User-Added Fields (Visit-Only)

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `My Tags` | N | N | R | R | User-assigned tags. Array of strings |
| `My Notes` | N | N | R | R | User-written notes. String or array |

### Extended Data (Visit-Only)

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `extended` | N | N | C | C | Object containing `positions[]`, `schools[]`, `skills[]` |
| `extended.positions` | N | N | C | C | Full work history (all roles, not just current) |
| `extended.schools` | N | N | C | C | Education history |
| `extended.skills` | N | N | C | C | Skills list |

### Metadata Fields (All Types)

| Webhook Field | Scan (LinkedIn) | Scan (Sales Nav) | Visit (LinkedIn) | Visit (Sales Nav) | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `VisitTime` / `ScanTime` | A | A | A | A | Timestamp of the extraction event |
| `userid` | A | A | A | A | DuxSoup user account that performed the extraction |
| `time` | A | A | A | A | Event creation timestamp (top-level payload) |
| `type` | A | A | A | A | `"visit"` or `"scan"` |
| `event` | A | A | A | A | `"create"` or `"update"` |
| `messagecontext` | R | R | R | R | Message context identifier (visit-only in schema) |

---

## 3. Connection Degree Impact

The connection degree between the DuxSoup user and the target profile significantly affects data availability:

### 1st-Degree Connections (Direct Connections)

Full data access. All fields available:

| Field Category | Available | Notes |
|---|---|---|
| Basic profile | Yes | Name, photo, headline, location |
| Contact info | **Yes** | Email, phone, IM, Twitter, personal website |
| Summary/About | Yes | Full bio text |
| Work history | Yes | All positions via `extended.positions` (visit) |
| Education | Yes | All schools via `extended.schools` (visit) |
| Skills | Yes | All skills via `extended.skills` (visit) |
| Company website | Yes | Via visit |
| Birthday | **Sometimes** | If shared by the member |
| Connection count | Yes | Exact or `"500+"` |

### 2nd-Degree Connections (Friend of a friend)

Most profile data available, contact info restricted:

| Field Category | Available | Notes |
|---|---|---|
| Basic profile | Yes | Name, photo, headline, location |
| Contact info | **No** | Email, phone, IM, Twitter, personal website are hidden |
| Summary/About | **Usually** | May be restricted by privacy settings |
| Work history | Yes | Via `extended.positions` (visit) |
| Education | Yes | Via `extended.schools` (visit) |
| Skills | Yes | Via `extended.skills` (visit) |
| Company website | Sometimes | May appear in visits |
| Birthday | No | Not visible |
| Connection count | Yes | Exact or `"500+"` |

### 3rd-Degree & Out-of-Network Connections

Most restricted data access:

| Field Category | Available | Notes |
|---|---|---|
| Basic profile | **Partial** | Name (may be abbreviated), photo, headline |
| Contact info | **No** | All contact fields hidden |
| Summary/About | **Rarely** | Depends on privacy settings |
| Work history | **Partial** | Current + some history via visit; may be truncated |
| Education | **Partial** | May be limited |
| Skills | **Partial** | May be limited |
| Company website | Rarely | Usually not available |
| Birthday | No | Not visible |
| Connection count | Sometimes | May show `"500+"` only |

### Summary: Connection Degree vs. Data Richness

```
1st Degree ████████████████████████████████ 100% (all fields)
2nd Degree ██████████████████████████       ~80% (no contact info)
3rd Degree ████████████████                 ~50% (partial profile, no contact)
Out of Net ████████████                     ~40% (minimal, may truncate names)
```

---

## 4. Webhook Payload Structure

Every DuxSoup webhook arrives with this top-level structure:

```json
{
  "userid": "duxsoup_user_12345",
  "time": "2026-01-07T09:15:42.000Z",
  "type": "visit",
  "event": "create",
  "messagecontext": "campaign_abc",
  "data": {
    "id": "pid.michael-rodriguez-987654",
    "VisitTime": "2026-01-07T09:15:42.000Z",
    "Profile": "https://www.linkedin.com/in/michael-rodriguez-987654/",
    "First Name": "Michael",
    "Last Name": "Rodriguez",
    ...
  }
}
```

| Level | Field | Description |
|---|---|---|
| Top-level | `userid` | DuxSoup account that triggered the event |
| Top-level | `time` | When the event was created |
| Top-level | `type` | `"visit"` or `"scan"` |
| Top-level | `event` | `"create"` (new) or `"update"` (re-processed) |
| Top-level | `messagecontext` | Optional campaign/context identifier |
| Nested | `data` | **All profile data lives here** |
| Nested | `data.id` | DuxSoup internal profile ID |

The `data` object contains all the profile fields documented in Section 2.

---

## 5. Field Definitions — Observation Layer

These fields are stored in the **Visit** and **Scan** collections exactly as received (with minor transformations).

### Visit Schema (`src/models/visit.js`)

| Field | Type | Required | Source | Description |
|---|---|---|---|---|
| `id` | String | Yes | `data.id` | DuxSoup profile ID (format: `pid.<username>`) |
| `VisitTime` | Date | Yes | `data.VisitTime` | When the profile was visited |
| `Profile` | String | No | `data.Profile` | LinkedIn profile URL (unstable) |
| `First Name` | String | Yes | `data.First Name` | Member's first name |
| `Last Name` | String | No | `data.Last Name` | Member's last name |
| `Middle Name` | String | No | `data.Middle Name` | Member's middle name |
| `Degree` | String | Yes | `data.Degree` | Connection degree (`"1st"`, `"2nd"`, `"3rd+"`) |
| `SalesProfile` | String | No | `data.SalesProfile` | Sales Navigator profile URL |
| `RecruiterProfile` | String | No | `data.RecruiterProfile` | Recruiter profile URL |
| `Picture` | String | No | `data.Picture` | Profile photo URL |
| `Connections` | String | No | `data.Connections` | Connection count (`"500+"`, `"1234"`) |
| `Summary` | String | No | `data.Summary` | About/bio section |
| `Title` | String | No | `data.Title` | Current job title |
| `From` | String | No | `data.From` | Start year/date at current role |
| `Company` | String | No | `data.Company` | Current company name |
| `CompanyProfile` | String | No | `data.CompanyProfile` | Company LinkedIn URL |
| `CompanyWebsite` | String | No | `data.CompanyWebsite` | Company website URL |
| `PersonalWebsite` | String | No | `data.PersonalWebsite` | Member's personal website |
| `Email` | String | No | `data.Email` | Email address (1st-degree only) |
| `Phone` | String | No | `data.Phone` | Phone number (1st-degree only) |
| `IM` | String | No | `data.IM` | Instant messaging handle (1st-degree only) |
| `Twitter` | String | No | `data.Twitter` | Twitter/X handle (1st-degree only) |
| `Location` | String | No | `data.Location` | Free-text location string |
| `Birthday` | String | No | `data.Birthday` | Birth date string (format varies) |
| `Industry` | String | No | `data.Industry` | Industry classification (free text) |
| `My Tags` | [String] | No | `data.My Tags` | User-assigned tags |
| `My Notes` | Mixed | No | `data.My Notes` | User-written notes |
| `extended` | Mixed | No | `data.extended` | Rich data object (see Section 6) |
| `city` | String | No | Parsed | Parsed from `Location` |
| `state` | String | No | Parsed | Parsed from `Location` |
| `stateCode` | String | No | Parsed | Parsed from `Location` |
| `country` | String | No | Parsed | Parsed from `Location` |
| `countryCode` | String | No | Parsed | Parsed from `Location` |
| `province` | String | No | Parsed | Parsed from `Location` |
| `region` | String | No | Parsed | Parsed from `Location` |
| `locationType` | String | No | Parsed | `"city"`, `"metropolitan"`, or `"unknown"` |
| `userid` | String | No | `payload.userid` | DuxSoup user who performed the visit |
| `time` | Date | No | `payload.time` | Event creation timestamp |
| `type` | String | No | `payload.type` | `"visit"` |
| `event` | String | No | `payload.event` | `"create"` or `"update"` |
| `messagecontext` | String | No | `payload.messagecontext` | Campaign/context identifier |
| `rawData` | Mixed | No | Full payload | Complete original webhook payload (max 1MB) |
| `event_key` | String | No | Computed | SHA1 idempotency key: `sha1(userid + type + time + id)` |

### Scan Schema (`src/models/scan.js`)

| Field | Type | Required | Source | Description |
|---|---|---|---|---|
| `id` | String | Yes | `data.id` | DuxSoup profile ID |
| `ScanTime` | Date | Yes | `data.ScanTime` | When the profile was scanned |
| `Profile` | String | No | `data.Profile` | LinkedIn profile URL |
| `First Name` | String | Yes | `data.First Name` | Member's first name |
| `Last Name` | String | Yes | `data.Last Name` | Member's last name |
| `Middle Name` | String | No | `data.Middle Name` | Member's middle name |
| `Company` | String | No | `data.Company` | Current company name |
| `CompanyID` | String | No | `data.CompanyID` | **LinkedIn numeric company ID** (scan-exclusive) |
| `CompanyProfile` | String | No | `data.CompanyProfile` | Company LinkedIn URL |
| `Title` | String | No | `data.Title` | Current job title |
| `Location` | String | No | `data.Location` | Free-text location string |
| `Birthday` | String | No | `data.Birthday` | Birth date string |
| `Industry` | String | No | `data.Industry` | Industry classification |
| `Connection Degree` | String | No | `data.Connection Degree` | Connection degree (scan format) |
| `Profile URL` | String | No | `data.Profile URL` | Profile URL (scan-specific field) |
| `PublicProfile` | String | No | `data.PublicProfile` | Public profile URL |
| `Degree` | String | No | `data.Degree` | Connection degree (shared format) |
| `Picture` | String | No | `data.Picture` / `data.Thumbnail` | Profile photo URL |
| `Connections` | String | No | `data.Connections` | Connection count |
| `Summary` | String | No | `data.Summary` | About/bio section |
| `SalesProfile` | String | No | `data.SalesProfile` | Sales Navigator profile URL |
| `RecruiterProfile` | String | No | `data.RecruiterProfile` | Recruiter profile URL |
| `city`...`locationType` | String | No | Parsed | Parsed location fields (same as Visit) |
| `rawData` | Mixed | No | Full payload | Complete original webhook payload |
| `event_key` | String | No | Computed | SHA1 idempotency key |

### Scan vs. Visit: Field Differences

| Category | Visit-Only Fields | Scan-Only Fields |
|---|---|---|
| **Contact** | `Email`, `Phone`, `IM`, `Twitter`, `PersonalWebsite` | — |
| **Company** | `CompanyWebsite`, `CompanyProfile`, `From` | `CompanyID` |
| **Extended** | `extended` (positions, schools, skills) | — |
| **User Data** | `My Tags`, `My Notes` | — |
| **URL Fields** | — | `Profile URL`, `PublicProfile`, `Connection Degree` |
| **Metadata** | `userid`, `time`, `type`, `event`, `messagecontext` | — (stored in `rawData` only) |

---

## 6. Field Definitions — Extended Data (Visits Only)

The `extended` object is only present in **Visit** observations. It contains the deep profile data that requires an actual profile page visit to extract.

### `extended.positions[]` — Work History

Each position object:

| Field | Type | Example | Description |
|---|---|---|---|
| `Title` | String | `"VP of Engineering"` | Job title |
| `Company` | String | `"DataCore Inc"` | Company name |
| `Location` | String | `"Austin, Texas"` | Position-specific location |
| `From` | String | `"Jan 2023"` | Start date (format varies: `"2023"`, `"Jan 2023"`, `"January 2023"`) |
| `To` | String | `"Present"` or `"Dec 2022"` | End date or `"Present"` for current role |
| `Description` | String | `"Leading engineering..."` | Role description text |

**Example:**
```json
{
  "Title": "VP of Engineering",
  "Company": "DataCore Inc",
  "Location": "Austin, Texas",
  "From": "Jan 2023",
  "To": "Present",
  "Description": "Leading engineering team of 45+ engineers..."
}
```

**Notes:**
- Date formats are inconsistent — handled by `date-parser.js`
- `"Present"` indicates a current role
- Positions are ordered most-recent-first (typically)
- Not all positions have all fields; `Description` and `Location` are frequently missing

### `extended.schools[]` — Education History

Each school object:

| Field | Type | Example | Description |
|---|---|---|---|
| `Name` | String | `"Stanford University"` | School/institution name |
| `Degree` | String | `"Master of Science"` | Degree type |
| `Field` | String | `"Computer Science"` | Field of study / major |
| `From` | String | `"2014"` | Start year |
| `To` | String | `"2016"` | End year |

**Example:**
```json
{
  "Name": "Stanford University",
  "Degree": "Master of Science",
  "Field": "Computer Science",
  "From": "2014",
  "To": "2016"
}
```

**Notes:**
- Years only (no month precision typically)
- `Degree` and `Field` are sometimes combined or missing

### `extended.skills[]` — Skills List

A flat array of skill name strings:

```json
["Distributed Systems", "Engineering Leadership", "Python", "Go", "Kubernetes", "AWS"]
```

**Notes:**
- No endorsement counts or proficiency levels
- Ordered by LinkedIn's display order (usually most-endorsed first)
- Can contain 50+ skills for well-established profiles

---

## 7. Field Definitions — Person Snapshot

The Person model (`src/models/person.js`) is the canonical state built from all observations. Fields are updated using precedence rules (visit > scan, newer > older, never overwrite with empty).

### Identity Fields

| Snapshot Field | Type | Source | Description |
|---|---|---|---|
| `_id` | String | Computed | Best stable ID: Sales Nav ID > numeric ID > username |
| `canonical_id` | String | Computed | Deterministic UUID v5 from `_id` |
| `aliases` | Array | All observations | All known identifiers for this person |
| `aliases[].type` | String | — | One of: `linkedInUsername`, `salesNavId`, `numericId`, `duxsoupId`, `profileUrl`, `publicUrl`, `salesUrl`, `recruiterUrl` |
| `aliases[].value` | String | — | The identifier value |
| `aliases[].addedAt` | Date | — | When this alias was first seen |

### Basic Profile Fields

| Snapshot Field | Type | Webhook Source | Transform | Description |
|---|---|---|---|---|
| `snapshot.firstName` | String | `First Name` | Trim | First name |
| `snapshot.middleName` | String | `Middle Name` | Trim | Middle name |
| `snapshot.lastName` | String | `Last Name` | Trim | Last name |
| `snapshot.fullName` | String | Computed | Join first + middle + last | Full display name |
| `snapshot.birthday` | Date | `Birthday` | `parseSafeDate()` | Birth date |
| `snapshot.profilePicture` | String | `Picture` | None | Profile photo URL |
| `snapshot.thumbnail` | String | `Thumbnail` | None | Smaller profile photo |
| `snapshot.connections` | Number | `Connections` | `parseConnections()` — strips `"+"`, converts to int | Connection count |
| `snapshot.degree` | Number | `Degree` / `Connection Degree` | `parseDegree()` — converts `"1st"` to `1` | Connection degree (1-3) |
| `snapshot.summary` | String | `Summary` | Trim | About/bio text |
| `snapshot.industry` | String | `Industry` | Trim | Industry string |

### Position Fields

| Snapshot Field | Type | Webhook Source | Transform | Description |
|---|---|---|---|---|
| `snapshot.currentTitle` | String | `Title` | Trim | Current job title |
| `snapshot.currentCompany` | String | `Company` | Trim | Current company name |
| `snapshot.currentCompanyId` | String | `CompanyID` | Trim | LinkedIn numeric company ID |
| `snapshot.currentCompanyUrl` | String | Computed | `www.linkedin.com/company/{id}` | Company LinkedIn URL |
| `snapshot.currentCompanyProfile` | String | `CompanyProfile` | Trim | Raw company profile URL |
| `snapshot.parsedSeniority` | String | Computed | `parseTitle()` | Seniority level (see Section 12) |
| `snapshot.parsedDepartment` | String | Computed | `parseTitle()` | Department/function (see Section 12) |

### Location Fields

| Snapshot Field | Type | Webhook Source | Transform | Description |
|---|---|---|---|---|
| `snapshot.location` | String | `Location` | Trim | Raw location string |
| `snapshot.city` | String | Parsed | `parseLocation()` | City name |
| `snapshot.state` | String | Parsed | `parseLocation()` | State/province name |
| `snapshot.stateCode` | String | Parsed | `parseLocation()` | 2-letter state code |
| `snapshot.country` | String | Parsed | `parseLocation()` | Country name |
| `snapshot.countryCode` | String | Parsed | `parseLocation()` | ISO 3166-1 alpha-2 code |
| `snapshot.province` | String | Parsed | `parseLocation()` | Province (non-US) |
| `snapshot.region` | String | Parsed | `parseLocation()` | Region/area name |
| `snapshot.locationType` | String | Parsed | `parseLocation()` | `"city"`, `"metropolitan"`, `"unknown"` |

### Contact Fields

| Snapshot Field | Type | Webhook Source | Transform | Description |
|---|---|---|---|---|
| `snapshot.email` | String | `Email` | Trim | Email address |
| `snapshot.phone` | String | `Phone` | E.164 via libphonenumber-js | Phone number normalized to E.164 format (e.g. `+15551234567`). Uses person's `countryCode` as default country when available, falls back to US. Unparseable numbers are digit-stripped. |
| `snapshot.twitter` | String | `Twitter` | Trim | Twitter/X handle |
| `snapshot.personalWebsite` | String | `PersonalWebsite` | Trim | Personal website URL |
| `snapshot.companyWebsite` | String | `CompanyWebsite` | Trim | Company website URL |

### Professional History Fields

| Snapshot Field | Type | Source | Description |
|---|---|---|---|
| `snapshot.roles` | [Role] | `extended.positions` or current Title+Company | Career timeline |
| `snapshot.roles[].title` | String | `positions[].Title` | Job title |
| `snapshot.roles[].companyName` | String | `positions[].Company` | Company name |
| `snapshot.roles[].companyId` | String | Resolved | LinkedIn company numeric ID |
| `snapshot.roles[].location` | String | `positions[].Location` | Position-specific location |
| `snapshot.roles[].description` | String | `positions[].Description` | Role description |
| `snapshot.roles[].startDate` | Date | `positions[].From` | Parsed start date |
| `snapshot.roles[].endDate` | Date | `positions[].To` | Parsed end date (`null` if current) |
| `snapshot.roles[].isCurrent` | Boolean | Computed | `true` if `To === "Present"` or missing |
| `snapshot.education` | [Education] | `extended.schools` | Education history |
| `snapshot.education[].school` | String | `schools[].Name` | School name |
| `snapshot.education[].degree` | String | `schools[].Degree` | Degree type |
| `snapshot.education[].field` | String | `schools[].Field` | Field of study |
| `snapshot.education[].startDate` | Date | `schools[].From` | Parsed start date |
| `snapshot.education[].endDate` | Date | `schools[].To` | Parsed end date |
| `snapshot.skills` | [String] | `extended.skills` | Accumulated skill list |

### Provenance Metadata

| Field | Type | Description |
|---|---|---|
| `snapshot._meta` | Object | Provenance tracking for every snapshot field |
| `snapshot._meta.<fieldName>.value` | Mixed | The field's current value |
| `snapshot._meta.<fieldName>.observedAt` | Date | When this value was observed |
| `snapshot._meta.<fieldName>.source` | String | `"visit"` or `"scan"` |
| `snapshot._meta.<fieldName>.observationId` | ObjectId | Reference to the source observation |

### Observation & System Metadata

| Field | Type | Description |
|---|---|---|
| `observations.visits` | [ObjectId] | References to Visit documents |
| `observations.scans` | [ObjectId] | References to Scan documents |
| `meta.lastObservedAt` | Date | Timestamp of most recent observation |
| `meta.lastObservation.type` | String | `"visit"` or `"scan"` |
| `meta.lastObservation.id` | ObjectId | Most recent observation reference |
| `meta.lastObservation.observedAt` | Date | Most recent observation timestamp |
| `meta.observationsCount` | Number | Total visits + scans for this person |
| `derived.avgTenureMonths` | Number | Average months per role |
| `derived.yearsAtCurrentCompany` | Number | Years at current company |
| `mergedInto` | String | If merged, the target person `_id` |
| `mergedAt` | Date | When the merge occurred |
| `createdAt` | Date | Document creation timestamp |
| `updatedAt` | Date | Last document update timestamp |

---

## 8. Field Definitions — Company Snapshot

The Company model (`src/models/company.js`) is derived from person observations.

| Snapshot Field | Type | Source | Description |
|---|---|---|---|
| `_id` | String | `CompanyID` or extracted from `CompanyProfile` URL | LinkedIn numeric company ID |
| `canonical_id` | String | Computed | Deterministic UUID |
| `aliases[].type` | String | — | `"numericId"`, `"profileUrl"`, or `"name"` |
| `snapshot.name` | String | `Company` | Company display name |
| `snapshot.industry` | String | `Industry` | Industry from person observations |
| `snapshot.location` | String | — | Not currently populated from observations |
| `snapshot.description` | String | — | Not currently populated |
| `snapshot.companyProfileUrl` | String | `CompanyProfile` | LinkedIn company page URL |
| `snapshot.website` | String | `CompanyWebsite` | Company website (visit-only source) |
| `snapshot.employeeCount` | String | — | Not currently populated |
| `snapshot.founded` | String | — | Not currently populated |

**Note:** Company snapshots are intentionally thin — they are populated only from fields that appear in person observations, not from direct company page scraping.

---

## 9. Field Definitions — Location Snapshot

The Location model (`src/models/location.js`) is derived from location strings in observations.

| Snapshot Field | Type | Source | Description |
|---|---|---|---|
| `_id` | String | Computed | Slugified location (e.g., `"austin-texas-united-states"`) |
| `canonical_id` | String | Computed | Deterministic UUID |
| `aliases[].type` | String | — | `"raw"` or `"normalized"` |
| `snapshot.name` | String | `Location` | Original location string |
| `snapshot.normalized` | String | Computed | Whitespace-normalized version |
| `snapshot.city` | String | Parsed | City name |
| `snapshot.state` | String | Parsed | State name |
| `snapshot.stateCode` | String | Parsed | 2-letter state code |
| `snapshot.country` | String | Parsed | Country name |
| `snapshot.countryCode` | String | Parsed | ISO country code |
| `snapshot.province` | String | Parsed | Province (non-US) |
| `snapshot.region` | String | Parsed | Region/area |
| `snapshot.locationType` | String | Parsed | `"city"`, `"metropolitan"`, `"unknown"` |

---

## 10. Field Flow: Webhook to Snapshot

This traces how each webhook field flows through the pipeline.

```
Webhook Payload
    │
    ├─ Top-level: userid, time, type, event, messagecontext
    │
    └─ data: { profile fields }
         │
         ├──────────────────────────────────┐
         ▼                                  ▼
    Observation Layer                  Identity Resolution
    (Visit or Scan doc)                (identityMatcher.js)
         │                                  │
         │  Stored as-is                    │  Extracts: salesNavId,
         │  (immutable)                     │  numericId, username,
         │                                  │  profileUrl, duxsoupId
         │                                  │
         ▼                                  ▼
    Person Snapshot                    Company Snapshot
    (personController.js)             (companyController.js)
         │                                  │
         ├─ normalizeField()               ├─ applySnapshotValue()
         │  with precedence rules          │  (simple non-empty check)
         │                                  │
         ├─ updateRolesTimeline()          └─ Upserts Company doc
         │  from extended.positions
         │
         ├─ Education from extended.schools
         │
         ├─ Skills from extended.skills
         │
         ├─ parseTitle() enrichment
         │
         ├─ computeDerivedMetrics()
         │
         ├─ detectChanges()
         │
         └─ Upserts Person doc
```

### Precedence Rules (personController.js)

When updating a Person snapshot field:

1. **Never overwrite with empty** — `null`, `undefined`, or `""` incoming values are ignored
2. **Visit beats Scan** — A visit-sourced value always overwrites a scan-sourced value
3. **Newer beats Older** — Within the same source type, the more recent observation wins
4. **Tracked via `_meta`** — Every field update records the source, timestamp, and observation ID

---

## 11. Identity Resolution Fields

How stable identifiers are extracted from webhook data:

| Identifier Type | Stability | Source Fields | Extraction Pattern | Example |
|---|---|---|---|---|
| `salesNavId` | Highest | `SalesProfile`, `RecruiterProfile` | Regex: `/(ACwAA\|ACoAA)[A-Za-z0-9_-]+/` | `ACwAABjK8PoBZx4nYtR2jLmQw5vXcDuF1pHsGxE` |
| `numericId` | High | `id` (DuxSoup ID) | Extracted by `salesNavIdExtractor.js` | `12345678` |
| `linkedInUsername` | Medium-High | `id`, `Profile`, `PublicProfile`, `SalesProfile` | Regex: `/\/in\/([a-zA-Z0-9_-]+)/` or `pid.<username>` | `michael-rodriguez-987654` |
| `profileUrl` | Medium | `Profile` | Normalized URL (protocol/www stripped) | `linkedin.com/in/michael-rodriguez-987654` |
| `publicUrl` | Medium | `PublicProfile`, `Profile` | Normalized to `linkedin.com/(in|pub)/<slug>` | `linkedin.com/in/michael-rodriguez-987654` |
| `recruiterUrl` | Low | `RecruiterProfile` | Normalized URL | `linkedin.com/talent/profile/...` |
| `salesUrl` | Low | `SalesProfile` | Normalized URL (full) | `linkedin.com/sales/lead/ACwAA...,NAME_SEARCH,Xyz9` |
| `duxsoupId` | Lowest | `id` | Lowercase normalization | `pid.michael-rodriguez-987654` |

### Waterfall Priority (from `identityMatcher.js`)

```
1. Sales Navigator ID   ──── Most stable, never changes
2. Numeric ID           ──── LinkedIn member ID, immutable
3. LinkedIn Username    ──── Stable across platforms
4. Profile URL          ──── Can change (vanity name edits)
5. Public Profile       ──── Can change
6. Recruiter Profile    ──── Rare
7. DuxSoup ID           ──── Changes between scan sources
```

---

## 12. Derived & Enriched Fields

These fields are computed during ingestion, not extracted from webhooks.

### Title Parsing (`src/utils/titleParser.js`)

Enriches `snapshot.currentTitle` into:

| Derived Field | Values | Example Input → Output |
|---|---|---|
| `parsedSeniority` | `c-suite`, `founder`, `vp`, `director`, `head`, `manager`, `lead`, `senior`, `mid`, `junior`, `intern` | `"VP of Engineering"` → `"vp"` |
| `parsedDepartment` | `engineering`, `data`, `product`, `design`, `marketing`, `sales`, `customer_success`, `finance`, `hr`, `legal`, `operations`, `consulting` | `"VP of Engineering"` → `"engineering"` |

### Derived Metrics (`personController.js`)

Computed from `snapshot.roles`:

| Derived Field | Formula | Description |
|---|---|---|
| `derived.avgTenureMonths` | `totalMonths / roleCount` | Average tenure per role |
| `derived.yearsAtCurrentCompany` | `(now - startDate) / 365.25` for current role | Years at current company |

### Location Parsing (`src/utils/location-parser.js`)

Parses free-text `Location` string into structured fields:

| Input | city | state | stateCode | country | countryCode | locationType |
|---|---|---|---|---|---|---|
| `"San Francisco, California, United States"` | San Francisco | California | CA | United States | US | city |
| `"San Francisco Bay Area"` | — | — | — | United States | US | metropolitan |
| `"London, England, United Kingdom"` | London | England | — | United Kingdom | GB | city |
| `"Greater New York City Area"` | — | — | — | United States | US | metropolitan |
| `"India"` | — | — | — | India | IN | unknown |

### Change Detection (`src/services/changeDetectionService.js`)

Compares old vs. new snapshot to detect:

| Change Type | Detection Logic | Stored In |
|---|---|---|
| `company_change` | `currentCompany` changed between observations | `Change` collection |
| `promotion` | `currentTitle` changed, `currentCompany` stayed the same | `Change` collection |
| `title_change` | `currentTitle` changed (generic) | `Change` collection |

---

## 13. Fields NOT Currently Captured

Data that DuxSoup may deliver but is **not extracted or stored** by the current ETL:

### Potentially Available in `rawData` But Not Mapped

| Field | Where It May Appear | Why Not Captured | Potential Value |
|---|---|---|---|
| `Thumbnail` | Visit `rawData` | Partially mapped (to `snapshot.thumbnail`) but inconsistent | Lower-res profile image |
| Endorsement counts | `extended.skills` sub-objects (if present) | Skills stored as flat strings | Skill credibility signal |
| Company description | Company pages (not scraped) | Only person observations feed companies | Company intelligence |
| Company size/employee count | Company pages (not scraped) | Not in person observation data | Firmographic data |
| Shared connections | Profile page | Not extracted by DuxSoup | Warm intro paths |
| Profile language/locale | Profile page | Not extracted by DuxSoup | Outreach language |
| Volunteer experience | Profile page | Not extracted by DuxSoup | Values alignment |
| Certifications | Profile page | Not extracted by DuxSoup | Expertise signals |
| Publications | Profile page | Not extracted by DuxSoup | Thought leadership |
| Patents | Profile page | Not extracted by DuxSoup | Innovation signals |
| Courses | Profile page | Not extracted by DuxSoup | Learning interests |
| Honors/awards | Profile page | Not extracted by DuxSoup | Achievement signals |
| Contact interests | Profile page | Not extracted by DuxSoup | Intent signals (e.g., "open to grabbing coffee") |
| Vanity name changes | Inferred from Profile URL changes | Not tracked over time | Rebranding/career pivot signal |
| Connection count history | Multi-observation comparison | Not stored as time series | Networking velocity signal |

### Fields Available in LinkedIn API But Not DuxSoup

| LinkedIn API Field | Description | Possible Future Source |
|---|---|---|
| `geoLocation.geo` (Bing Geo URN) | Standardized location ID | Would enable exact geo matching |
| `industryId` (URN) | Standardized industry code | Would eliminate free-text industry ambiguity |
| `vanityName` | Canonical username | Better than parsing from URLs |
| `positions.company` (Org URN) | `urn:li:organization:{id}` | Stable company reference per role |
| `positions.id` | Unique position ID | Would prevent role deduplication issues |
| `phoneNumbers[].type` | WORK/HOME/MOBILE | Outreach channel optimization |
| `websites[].category` | PERSONAL/COMPANY/BLOG/PORTFOLIO | Content engagement signals |
| `maidenName` | Maiden/previous name | Identity resolution across name changes |
| `supportedLocales` | Profile language translations | Multilingual outreach |
| `birthDate` (structured) | `{day, month, year}` | More reliable than free-text parsing |
| `memberRichContents` | Featured section (articles, posts, media) | Content engagement / thought leadership |

---

## Appendix: Quick Reference Cards

### What Data Do I Get from a Scan?

```
SCAN = Basic profile card data
├── Name (first, last, middle)
├── Title + Company
├── Location + Industry
├── Connection Degree + Count
├── Profile Photo
├── Summary (sometimes)
├── Profile URLs (LinkedIn, Sales Nav)
├── CompanyID (scan-only, from Sales Nav)
└── NO: Contact info, work history, education, skills, tags, notes
```

### What Data Do I Get from a Visit?

```
VISIT = Full profile page data
├── Everything from Scan, PLUS:
├── Contact Info (1st-degree only):
│   ├── Email, Phone, IM, Twitter
│   └── Personal Website, Company Website
├── Extended Data:
│   ├── positions[] — Full work history
│   ├── schools[] — Education history
│   └── skills[] — Skills list
├── User Data:
│   ├── My Tags
│   └── My Notes
├── Current Role Details:
│   └── From (start date)
└── CompanyProfile URL (contains company ID)
```

### What Extra Do I Get from Sales Navigator?

```
SALES NAVIGATOR BONUS:
├── SalesProfile URL (contains Sales Nav ID — most stable identifier)
├── CompanyID (numeric, in scans)
└── Sometimes additional position/company data in extended fields
```

### What Extra Do I Get from 1st-Degree Connections?

```
1ST-DEGREE BONUS:
├── Email address
├── Phone number
├── IM handles
├── Twitter handle
├── Personal website
├── Birthday (sometimes)
└── Richer Summary/About section
```
