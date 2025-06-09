# DuxSoup LinkedIn ETL System

A production-ready webhook-driven LinkedIn data processing system that handles scan and visit data with MongoDB storage and real-time processing.

**Share the Project:** https://github.com/harehimself/duxsoup-etl  
**DuxSoup Docs:** https://support.dux-soup.com/category/441-dux-soup-api-documentation

<br>

## Features

* **Webhook Processing** - Handles DuxSoup LinkedIn data via `POST /api/webhook`.
* **Type-Based Routing** - Automatically routes scan vs visit data to appropriate handlers based on the `type` field in the payload.
* **Data Validation** - Comprehensive validation for required fields, including a custom validator for the `id` field to ensure it's a non-empty string.
* **Error Handling** - Robust error handling with detailed logging using Winston.
* **Production Ready** - Designed for deployment on platforms like Render with health monitoring.
* **Extensible** - Easy to add MongoDB storage and data normalization.
* **MongoDB Storage** - Integrates with MongoDB using Mongoose to persist processed data.

<br>

## API Endpoints

### `POST /api/webhook`
Main webhook endpoint for DuxSoup data processing. It expects a JSON payload with a `type` field to route the data correctly.

**Request Body Examples:**

**Visit Data:**
```json
{
  "type": "visit",
  "id": "visit_12345",
  "VisitTime": "2025-06-06T10:30:00Z",
  ...
}
```

**Scan Data:**
```json
{
  "type": "scan",
  "id": "scan_67890",
  "ScanTime": "2025-06-06T14:15:00Z",
  ...
}
```

**Responses:**

- 200 OK - Success: Data processed successfully (inserted or updated).
- 400 Bad Request - Invalid payload/missing fields.
- 409 Conflict - Duplicate ID.
- 500 Internal Server Error - Server error.


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


### `GET /api/test`
Test endpoint for API verification.

<br>

## Data Models

The application uses Mongoose to define schemas for Visit and Scan data, ensuring data integrity and structure. Both models include createdAt and updatedAt timestamps.


### Visit Model

- id: String, Required, Unique, Indexed.
- VisitTime: Date, Required, Indexed.
- Profile: String, Required, Indexed.
- First Name: String, Required.
- Last Name: String (Optional).
- Other fields: SalesProfile, RecruiterProfile, Picture, Middle Name, Connections, Summary, Title, From, Company, CompanyProfile, CompanyWebsite, PersonalWebsite, Email, Phone, IM, Twitter, Location, Industry, My Tags (Array of Strings), extended (Mixed), My Notes (Mixed).
- rawData: Mixed type, stores the entire original webhook payload.


### Scan Model

- id: String, Required, Unique, Indexed.
- ScanTime: Date, Required, Indexed.
- Profile: String, Required, Indexed.
- First Name: String, Required.
- Last Name: String, Required.
- Other fields: Company, Title, Location, Industry, ConnectionDegree, ProfileUrl (Optional).
- rawData: Mixed type, stores the entire original webhook payload.

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

- Runtime: Node.js 18+
- Framework: Express.js
- Database: MongoDB Atlas
- ODM: Mongoose
- Logging: Winston
- Environment Variables: Dotenv
- CORS: Cors
- Deployment: Render
- Development: Nodemon

<br>

## Local Development


### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Git


### Step-by-Step Setup

**Clone Project and Install Dependencies:**

```bash
git clone https://github.com/harehimself/duxsoup-etl.git
cd duxsoup-etl
npm install
```

**Set Up MongoDB Atlas:**

1. Go to MongoDB Atlas and create a free cluster.
2. Create a database user and whitelist IP addresses.
3. Obtain your MongoDB connection string.

**Configure Environment:**

```bash
cp .env.example .env
```

Edit the `.env` file:

```env
PORT=3000
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/duxsoup-etl
NODE_ENV=development
```

**Test Locally**

```bash
npm run dev
```

**Health Check:**

```bash
curl http://localhost:3000/health
```

**Test Visit Webhook:**

```bash
curl -X POST -H "Content-Type: application/json" -d @examples/visit.json http://localhost:3000/api/webhook
```

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
3. Use `render.yaml` for config.
4. Set `MONGODB_URI` in dashboard.


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