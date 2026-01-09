# Production Environment Setup

## Overview

This guide explains how to configure and run the DuxSoup ETL system in production mode.

## Environment Configuration

### 1. Create Production Environment File

Create a `.env.production` file in the project root with your production settings:

```bash
NODE_ENV=production

# MongoDB Atlas Connection String
# Format: mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
MONGODB_URI=mongodb+srv://your-username:your-password@your-cluster.mongodb.net/duxsoup-etl-prod?retryWrites=true&w=majority

PORT=3000
LOG_LEVEL=info
```

**Important:** Never commit `.env.production` to git. It's already in `.gitignore`.

#### Getting Your MongoDB Atlas Connection String

1. Log into [MongoDB Atlas](https://cloud.mongodb.com/)
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Copy the connection string
5. Replace `<password>` with your database user password
6. Replace `<database>` with your database name (e.g., `duxsoup-etl-prod`)

### 2. Security Checklist

- [ ] Update `MONGODB_URI` with production database credentials
- [ ] Ensure MongoDB has proper authentication enabled
- [ ] Configure `CORS_ORIGIN` if needed for API access
- [ ] Review and set appropriate `LOG_LEVEL` (info, warn, error)
- [ ] Backup your database before running migrations

## Running Migrations in Production

The project includes safe npm scripts for running location migrations:

### Preview Changes (Dry Run)

```bash
npm run migrate:locations
```

**Safe:** Shows what would change without modifying data.

### Run Migration (Development)

```bash
npm run migrate:locations:run
```

**Uses:** Local development database from `.env`

### Run Migration (Production)

```bash
npm run migrate:locations:prod
```

**Uses:** Production database from `.env.production` or `NODE_ENV=production`

## Manual Production Execution

If you need more control, run scripts directly:

```bash
# Preview only
NODE_ENV=production node scripts/migrateLocationStructure.js --dry-run

# Limit to N records (for testing)
NODE_ENV=production node scripts/migrateLocationStructure.js --limit=100

# Full migration
NODE_ENV=production node scripts/migrateLocationStructure.js
```

## Database Connection Priority

The system looks for the MongoDB URI in this order:

1. `MONGODB_URI` environment variable
2. Falls back to: `mongodb://localhost:27017/duxsoup-etl`

## Recommended Production Workflow

1. **Backup your production database**

   **Option A: MongoDB Atlas UI (Recommended)**
   - Go to your Atlas cluster
   - Click "..." menu → "Take Snapshot Now"
   - Or use automatic scheduled backups (already enabled in Atlas)

   **Option B: Manual Export with mongodump**
   ```bash
   mongodump --uri="mongodb+srv://username:password@cluster.mongodb.net/duxsoup-etl-prod" --out=backup-$(date +%Y%m%d)
   ```

2. **Test with dry-run**

   ```bash
   npm run migrate:locations:prod
   ```

3. **Test with limited records**

   ```bash
   NODE_ENV=production node scripts/migrateLocationStructure.js --limit=10
   ```

4. **Run full migration**

   ```bash
   npm run migrate:locations:prod
   ```

5. **Verify results**
   ```bash
   mongosh your-prod-uri --eval "db.locations.findOne({}, {snapshot: 1})"
   ```

## Environment Variables Reference

| Variable      | Development   | Production         | Description         |
| ------------- | ------------- | ------------------ | ------------------- |
| `NODE_ENV`    | `development` | `production`       | Node environment    |
| `MONGODB_URI` | Local MongoDB | Production MongoDB | Database connection |
| `PORT`        | `3000`        | `3000`             | API server port     |
| `LOG_LEVEL`   | `debug`       | `info`             | Logging verbosity   |

## Troubleshooting

### Wrong Database Connected

Check which database you're connected to:

```bash
node -e "console.log(process.env.MONGODB_URI || 'mongodb://localhost:27017/duxsoup-etl')"
```

### Migration Failed Mid-Way

The migration is idempotent - safe to re-run. Already migrated locations will be updated again with the same values.

### Verify Production Mode

```bash
NODE_ENV=production node -e "console.log('Environment:', process.env.NODE_ENV)"
```
