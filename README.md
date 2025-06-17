<p align="center">
   <img src="https://raw.githubusercontent.com/harehimself/duxsoup-etl/master/duxsoup-etl.png">
</p>

<p align="center">
   A production-ready LinkedIn extraction pipeline. The system performs automatic LinkedIn profile extractions in real-time. Normalizes profile data into structured MongoDB Atlas records. Differentiates between scans and visits with custom routing. Includes health checks, validation, and logging. Built for background processing and extensibility. Useful for lead enrichment and graph-based CRM models.
   **DuxSoup Docs:** https://support.dux-soup.com/category/441-dux-soup-api-documentation
</p>
<br>

<p align="center">
  <a href="https://github.com/harehimself/duxsoup-etl/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/harehimself/duxsoup-etl" alt="Contributors"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/network/members">
    <img src="https://img.shields.io/github/forks/harehimself/duxsoup-etl" alt="Forks"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/stargazers">
    <img src="https://img.shields.io/github/stars/harehimself/duxsoup-etl" alt="Stars"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/issues">
    <img src="https://img.shields.io/github/issues/harehimself/duxsoup-etl" alt="Issues"></a>
  <a href="https://github.com/harehimself/duxsoup-etl/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/harehimself/duxsoup-etl" alt="MIT License"></a>
</p>

<br><br>

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Features](#features)
- [Benefits](#benefits)
- [How It Compares](#how-it-compares)
- [License](#license)
<br>

## Features

* **Webhook Processing**: Handles DuxSoup LinkedIn data via **`POST /api/webhook`**.
* **Type-Based Routing**: Automatically routes scan vs visit data to appropriate handlers based on the **`type`** field in the payload.
* **Data Validation**: Comprehensive validation for required fields, including a custom validator for the **`id`** field to ensure it's a non-empty string.
* **Error Handling**: Robust error handling with detailed logging using Winston.
* **Production Ready**: Designed for deployment on platforms like Render with health monitoring.
* **Extensible**: Easy to add MongoDB storage and data normalization.
* **MongoDB Storage**: Integrates with MongoDB using Mongoose to persist processed data.

<br>

## API Endpoints

### `POST /api/webhook`
Main webhook endpoint for DuxSoup data processing. It expects a JSON payload with a **`type`** field to route the data correctly.

**Request Body Examples:**

**Visit Data:**
```json
{
  "type": "visit",
  "id": "visit_12345",
  "VisitTime": "2025-06-06T10:30:00Z",
  "Profile": "[https://www.linkedin.com/in/johndoe/](https://www.linkedin.com/in/johndoe/)",
  "Degree": "MBA",
  "First Name": "John",
  "Last Name": "Doe",
  "Headline": "Senior Software Engineer at TechCorp",
  "Location": "San Francisco, CA",
  "Connections": "500+",
  "Position-0-Company": "TechCorp",
  "Position-0-Title": "Senior Software Engineer",
  "Position-0-StartDate": "Jan 2022",
  "Position-0-EndDate": "Present",
  "Position-0-Duration": "3 years 5 months",
  "Position-0-Location": "San Francisco, CA",
  "Position-0-Description": "Leading development of cloud-native applications",
  "Position-1-Company": "StartupXYZ",
  "Position-1-Title": "Software Engineer",
  "Position-1-StartDate": "Jun 2019",
  "Position-1-EndDate": "Dec 2021",
  "Position-1-Duration": "2 years 7 months",
  "Position-1-Location": "New York, NY",
  "School-0-School": "Stanford University",
  "School-0-Degree": "Master of Business Administration",
  "School-0-Field": "Technology Management",
  "School-0-StartYear": "2017",
  "School-0-EndYear": "2019",
  "School-1-School": "UC Berkeley",
  "School-1-Degree": "Bachelor of Science",
  "School-1-Field": "Computer Science",
  "School-1-StartYear": "2013",
  "School-1-EndYear": "2017",
  "Skill-0": "JavaScript",
  "Skill-1": "Node.js",
  "Skill-2": "React",
  "Skill-3": "MongoDB",
  "Skill-4": "AWS",
  "Summary": "Experienced software engineer with expertise in full-stack development",
  "Industry": "Technology"
}
```

<br>

**Scan Data:**
```json
{
  "type": "scan",
  "id": "scan_67890",
  "ScanTime": "2025-06-06T14:15:00Z",
  "Profile": "[https://www.linkedin.com/in/janesmith/](https://www.linkedin.com/in/janesmith/)",
  "First Name": "Jane",
  "Last Name": "Smith",
  "Headline": "Marketing Director at BigCorp",
  "Location": "Chicago, IL",
  "Connections": "1000+",
  "Position-0-Company": "BigCorp",
  "Position-0-Title": "Marketing Director",
  "Position-0-StartDate": "Mar 2021",
  "Position-0-EndDate": "Present",
  "Position-0-Duration": "4 years 3 months",
  "Position-0-Location": "Chicago, IL",
  "Position-1-Company": "MidSize Inc",
  "Position-1-Title": "Senior Marketing Manager",
  "Position-1-StartDate": "Jan 2018",
  "Position-1-EndDate": "Feb 2021",
  "Position-1-Duration": "3 years 2 months",
  "Position-1-Location": "Detroit, MI",
  "School-0-School": "Northwestern University",
  "School-0-Degree": "Master of Marketing",
  "School-0-StartYear": "2016",
  "School-0-EndYear": "2018",
  "Skill-0": "Digital Marketing",
  "Skill-1": "Brand Management",
  "Skill-2": "Analytics",
  "Summary": "Experienced marketing professional",
  "Industry": "Marketing"
}
```

<br>

**Responses:**

```json
{
  "status": "ok",
  "database": {
    "isConnected": true,
    "readyState": 1,
    "host": "your_mongodb_host",
    "name": "duxsoup-etl"
  },
  "timestamp": "2025-06-06T..."
}
```

<br>

### `GET /health`
Health check endpoint returning server and database status.

```json
{
  "status": "ok",
  "database": {
    "isConnected": true,
    "readyState": 1,
    "host": "your_mongodb_host",
    "name": "duxsoup-etl"
  },
  "timestamp": "2025-06-06T..."
}
```

<br>

### `GET /api/test`
Test endpoint for API verification.

<br>

## Data Models

The application uses Mongoose to define schemas for Visit and Scan data, ensuring data integrity and structure. Both models include createdAt and updatedAt timestamps.


### Visit Model

- **`id:`** String, Required, Unique, Indexed.
- **`VisitTime:`** Date, Required, Indexed.
- **`Profile:`** String, Required, Indexed.
- **`First Name:`** String, Required.
- **`Last Name:`** String (Optional).
- Additional Data Points: **`SalesProfile`**, **`RecruiterProfile`**, **`Picture`**, **`Middle Name`**, **`Connections`**, **`Summary`**, **`Title`**, **`From`**, **`Company`**, **`CompanyProfile`, **`CompanyWebsite`, **`PersonalWebsite`, `Email`, **`Phone`**, **`IM`**, **`Twitter`**, **`Location`**, **`Industry`**, etc.
- **`rawData:`** Mixed type, stores the entire original webhook payload.


<br>


### Scan Model

- **`id:`** String, Required, Unique, Indexed.
- **`ScanTime:`** Date, Required, Indexed.
- **`Profile:`** String, Required, Indexed.
- **`First Name:`** String, Required.
- **`Last Name:`** String, Required.
- Additional Data Points: **`Company`**, **`Title`**, **`Location`**, **`Industry`**, **`ConnectionDegree`**, **`ProfileUrl`**, etc.
- **`rawData:`** Mixed type, stores the entire original webhook payload.

<br>

## Data Normalization

Both models use pre-save hooks to normalize raw DuxSoup data from a flat format to structured arrays.

**Raw Format Example:**
```json
{
  "Position-0-Company": "TechCorp",
  "Position-0-Title": "Engineer",
  "School-0-School": "Stanford",
  "Skill-0": "JavaScript"
}
```

<br>


**Normalized Format Example:**
```json
{
  "positions": [
    { "company": "TechCorp", "title": "Engineer" }
  ],
  "schools": [
    { "school": "Stanford" }
  ],
  "skills": ["JavaScript"]
}
```

<br>

## 🛠️ Tech Stack

- **`Runtime:`** Node.js 18+
- **`Framework:`** Express.js
- **`Database:`** MongoDB Atlas
- **`ODM:`** Mongoose
- **`Logging:`** Winston
- **`Environment Variables:`** Dotenv
- **`CORS:`** Cors
- **`Deployment:`** Render
- **`Development:`** Nodemon

<br>

## Local Development


### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Git

<br>


### Step-by-Step Setup

**Clone Project and Install Dependencies:**

```bash
git clone https://github.com/harehimself/duxsoup-etl.git
cd duxsoup-etl
npm install
```

<br>

**Set Up MongoDB Atlas:**

1. Go to MongoDB Atlas and create a free cluster.
2. Create a database user and whitelist IP addresses.
3. Obtain your MongoDB connection string.

<br>

**Configure Environment:**

```bash
cp .env.example .env
```
<br>

Edit the **`.env`** file:

```env
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/duxsoup-etl
NODE_ENV=development
```

<br>

**Test Locally**

```bash
npm run dev
```

<br>

**Health Check:**

```bash
curl http://localhost:3000/health
```

<br>

**Test Visit Webhook:**

```bash
curl -X POST -H "Content-Type: application/json" -d @examples/visit.json http://localhost:3000/api/webhook
```

<br>

**Test Scan Webhook:**

```bash
curl -X POST -H "Content-Type: application/json" -d @examples/scan.json http://localhost:3000/api/webhook
```

<br>

## 📁 Project Structure

```
duxsoup-etl/
├── src/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── utils/
│   └── index.js
├── examples/
├── .env.example
├── package.json
├── render.yaml
└── README.md
```

<br>

## Deployment


### Option 1: Render (Recommended)

1. Push to GitHub.
2. Connect Render to GitHub repo.
3. Use **`render.yaml`** for config.
4. Set **`MONGODB_URI`** in dashboard.


### Option 2: Manual

```bash
npm install --production
npm start
```

<br>

## Development

**Available Scripts:**

- `npm start`
- `npm run dev`

**Adding New Fields:**

- Update models.
- Adjust normalization logic.
- Update controllers.
- Test with payloads.

<br>

## Debugging

- Check console logs (Winston).
- Monitor MongoDB Atlas.

<br>

## Troubleshooting

- **MongoDB Connection:** Check URI, IP whitelist, user permissions.
- **Validation Errors:** Confirm schema conformity.
- **Duplicate Key Errors:** Check uniqueness of `id`.

<br>

## Logs

- **Dev Logs:** Console.
- **Prod Logs:** Use Winston files.

<br>

## Monitoring

- `GET /health`
- Check MongoDB connectivity.

<br>

## Data Validation

- Schema + controller-level validation.
- Unique `id` fields.

<br>

## Security Notes

- Validate all inputs.
- Use environment variables.
- Enable CORS carefully.
- Consider webhook authentication.
