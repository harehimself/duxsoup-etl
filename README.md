<div align="center">
<a href="https://dux-soup.com" target="_blank" title="DuxSoup ETL"><img width="196px" alt="DuxSoup Logo" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTcMrv6rQvZIm5ufBRE7djADR64Q68vVJG2Xg&s"></a>

<a name="readme-top"></a>

DuxSoup LinkedIn ETL System
==================

A production-ready webhook-driven LinkedIn data processing system that handles scan and visit data with MongoDB storage and real-time processing.


**Share the Project:** https://github.com/harehimself/duxsoup-etl
<br>
**DuxSoup Docs:** https://support.dux-soup.com/category/441-dux-soup-api-documentation
<br><br>
[![Connect With Me On LinkedIn](https://img.shields.io/badge/Connect%20With%20Me%20On%20LinkedIn-blue)](https://www.linkedin.com/in/mike-hare)

</div>  

<br>

## Features

- **Webhook Processing** - Handles DuxSoup LinkedIn data via POST /api/webhook
- **Type-Based Routing** - Automatically routes scan vs visit data to appropriate handlers
- **Data Validation** - Comprehensive validation for required fields
- **Error Handling** - Robust error handling with detailed logging
- **Production Ready** - Deployed on Render with health monitoring
- **Extensible** - Easy to add MongoDB storage and data normalization

<br>

## API Endpoints

### POST /api/webhook
Main webhook endpoint for DuxSoup data processing.

**Visit Data:**
```json
{
  "type": "visit",
  "id": "visit_12345",
  "VisitTime": "2025-06-06T10:30:00Z",
  "Profile": "https://linkedin.com/in/johndoe",
  "Degree": "MBA",
  "First Name": "John"
}
```

**Scan Data:**
```json
{
  "type": "scan", 
  "id": "scan_67890",
  "ScanTime": "2025-06-06T14:15:00Z",
  "Profile": "https://linkedin.com/in/janesmith",
  "First Name": "Jane",
  "Last Name": "Smith"
}
```

### GET /health
Health check endpoint returning server status.

### GET /api/test
Test endpoint for API verification.

<br>

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** MongoDB Atlas (ready to integrate)
- **Logging:** Winston
- **Deployment:** Render
- **Development:** Nodemon

<br>

## Local Development

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Git

### Step-by-Step Setup

#### 1. Create Project Structure
```powershell
New-Item -ItemType Directory -Name "duxsoup-etl"
Set-Location "duxsoup-etl"

# Create directory structure
New-Item -ItemType Directory -Path "src\routes", "src\controllers", "src\models", "src\utils", "examples" -Force
```

#### 2. Initialize Node.js Project
```powershell
npm init -y
```

#### 3. Install Dependencies
```powershell
# Production dependencies
npm install express mongoose winston dotenv cors

# Development dependencies
npm install --save-dev nodemon
```

#### 4. Set Up MongoDB Atlas
1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Create free cluster
3. Create database user
4. Whitelist IP addresses (0.0.0.0/0 for development)
5. Get connection string

#### 5. Configure Environment
```powershell
# Copy example env file
Copy-Item ".env.example" ".env"

# Edit .env with your MongoDB URI
notepad .env
```

Update `.env`:
```bash
PORT=3000
MONGODB_URI=mongodb+srv://your-username:your-password@cluster.mongodb.net/duxsoup-etl?retryWrites=true&w=majority
NODE_ENV=development
```

#### 6. Create Files in Order

**Core files** (copy from artifacts above):
1. `package.json` - Project configuration
2. `src/utils/logger.js` - Winston logging setup
3. `src/models/Visit.js` - Visit schema with normalization
4. `src/models/Scan.js` - Scan schema with normalization
5. `src/controllers/visitController.js` - Visit data handler
6. `src/controllers/scanController.js` - Scan data handler
7. `src/routes/apiRoutes.js` - Route definitions
8. `src/index.js` - Express server entry point

**Example files**:
9. `examples/visit.json` - Sample visit payload
10. `examples/scan.json` - Sample scan payload

**Deployment**:
11. `render.yaml` - Render deployment config
12. `.env.example` - Environment template

#### 7. Test Locally
```bash
# Start development server
npm run dev

# Server should start on http://localhost:3000
```

#### 8. Test Endpoints

**Health Check:**
```bash
curl http://localhost:3000/health
```

**Test Visit Webhook:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/webhook" -Method POST -ContentType "application/json" -InFile "examples\visit.json"
```

**Test Scan Webhook:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/webhook" -Method POST -ContentType "application/json" -InFile "examples\scan.json"
```

## 📁 Project Structure
```
duxsoup-etl/
├── src/
│   ├── routes/
│   │   └── apiRoutes.js          # Webhook routing logic
│   ├── controllers/
│   │   ├── visitController.js    # Visit data processing
│   │   └── scanController.js     # Scan data processing
│   ├── models/
│   │   ├── Visit.js             # Visit schema + normalization
│   │   └── Scan.js              # Scan schema + normalization
│   ├── utils/
│   │   └── logger.js            # Winston logging
│   └── index.js                 # Express server
├── examples/
│   ├── visit.json               # Sample visit payload
│   └── scan.json                # Sample scan payload
├── .env.example                 # Environment template
├── render.yaml                  # Render deployment config
├── package.json                 # Dependencies
└── README.md                    # This file
```
<br>

## 🔌 API Endpoints

### POST /api/webhook
Main webhook endpoint for DuxSoup data.

**Request Body:**
```json
{
  "type": "visit" | "scan",
  "id": "unique_identifier",
  // ... other fields based on type
}
```

**Responses:**
- `200` - Success
- `400` - Invalid payload/missing fields
- `409` - Duplicate ID
- `500` - Server error

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-06-06T...",
  "uptime": 123.45
}
```
<br>

## Data Models

### Visit Model
**Required Fields:**
- `id` (String, unique)
- `VisitTime` (Date)
- `Profile` (String)
- `Degree` (String)
- `First Name` (String)

**Normalized Arrays:**
- `positions[]` - Up to 36 data points
- `schools[]` - Up to 20 data points
- `skills[]` - Up to 20 skills

### Scan Model
**Required Fields:**
- `id` (String, unique)
- `ScanTime` (Date)
- `Profile` (String)
- `First Name` (String)
- `Last Name` (String)

**Normalized Arrays:**
- `positions[]` - Up to 36 data points
- `schools[]` - Up to 20 data points
- `skills[]` - Up to 20 skills

<br>

## Data Normalization

Both models use pre-save hooks to normalize raw DuxSoup data:

**Raw Format:**
```json
{
  "Position-0-Company": "TechCorp",
  "Position-0-Title": "Engineer",
  "School-0-School": "Stanford",
  "Skill-0": "JavaScript"
}
```

**Normalized Format:**
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

## Deployment

### Option 1: Render (Recommended)
1. Push code to GitHub
2. Connect Render to repository
3. Render will use `render.yaml` configuration
4. Set environment variables in Render dashboard

### Option 2: Manual Deployment
```bash
# Production build
npm install --production
npm start
```
<br>

## Development

### Available Scripts
```bash
npm start     # Production server
npm run dev   # Development with nodemon
```

### Adding New Fields
1. Update model schemas in `src/models/`
2. Modify normalization logic in pre-save hooks
3. Update controllers if validation changes
4. Test with sample payloads

### Debugging
- Check logs in console (Winston)
- Use `/api/webhook/test` for testing
- Monitor MongoDB Atlas for data storage

<br>

## 🔍 Troubleshooting

### Common Issues

**MongoDB Connection Failed:**
- Verify connection string in `.env`
- Check IP whitelist in Atlas
- Ensure database user has correct permissions

**Validation Errors:**
- Check required fields in payload
- Verify data types (dates, strings)
- Review model schemas

**Duplicate Key Errors:**
- Each `id` must be unique per collection
- Use upsert logic in controllers

### Logs
```powershell
# View logs in development
npm run dev

# Production logs (if file logging enabled)
Get-Content "combined.log" -Wait
Get-Content "error.log" -Wait
```
<br>

## Monitoring

### Health Checks
- GET `/health` - Basic server status
- Monitor MongoDB connection
- Check Winston logs for errors

### Data Validation
- Required field validation in controllers
- Schema validation in models
- Duplicate prevention with unique IDs

<br>

## Security Notes

- Validate all incoming webhook data
- Use environment variables for secrets
- Enable CORS for specific origins in production
- Consider webhook authentication for DuxSoup

<br>

## 📚 Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | MongoDB Atlas |
| ODM | Mongoose |
| Logging | Winston |
| Deployment | Render |