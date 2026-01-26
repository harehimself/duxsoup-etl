#!/bin/bash

# Wrapper script to run backfill with proper environment loading

# Change to project directory
cd "$(dirname "$0")/.." || exit 1

# Export environment variables from .env file
if [ -f .env ]; then
    # Use set -a to automatically export all variables
    set -a
    source .env
    set +a
fi

# Verify MONGODB_URI or MONGO_URI is set
if [ -z "$MONGODB_URI" ] && [ -z "$MONGO_URI" ]; then
    echo "ERROR: MONGODB_URI (or MONGO_URI) environment variable is not set"
    exit 1
fi

# Run the backfill script with all passed arguments
node scripts/backfill-salesnavid-extraction.js "$@"
