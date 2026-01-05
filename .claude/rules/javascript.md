---
paths: "src/**/*.js"
---

# JavaScript Code Quality Standards

## Mandatory Behavior
**When writing or modifying JavaScript code:**
1. ALWAYS use `async/await` (never raw `.then()` chains)
2. ALWAYS use `AppError` for application errors
3. ALWAYS export Mongoose models using PascalCase
4. ALWAYS validate inputs before processing
5. Code will be auto-formatted by Prettier (don't fight it)

## Do / Don't Rules

### ✅ DO: Async Patterns
```javascript
// ✅ DO: Use async/await
async function processWebhook(data) {
  const observation = await Observation.create(data);
  const person = await updatePersonSnapshot(observation);
  return person;
}

// ❌ DON'T: Use .then() chains
function processWebhook(data) {
  return Observation.create(data)
    .then(obs => updatePersonSnapshot(obs))
    .then(person => person);
}
```

### ✅ DO: Error Handling
```javascript
// ✅ DO: Use AppError class
const { AppError } = require('../utils/errors');

async function findPerson(id) {
  if (!id) {
    throw new AppError('INVALID_INPUT', 'ID is required');
  }

  const person = await Person.findById(id);
  if (!person) {
    throw new AppError('NOT_FOUND', `Person ${id} not found`);
  }

  return person;
}

// ❌ DON'T: Throw generic errors
async function findPerson(id) {
  if (!id) throw new Error('Bad input'); // Too vague
  const person = await Person.findById(id);
  if (!person) throw new Error('Not found'); // No error code
  return person;
}
```

### ✅ DO: Error Response Format
```javascript
// ✅ DO: Consistent error responses
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: err.code,
      message: err.message
    });
  }

  // Unexpected errors
  return res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  });
});
```

### ✅ DO: Model Exports (PascalCase)
```javascript
// ✅ DO: Export models with PascalCase
const mongoose = require('mongoose');

const personSchema = new mongoose.Schema({
  salesNavId: String,
  snapshot: Object,
  observations: [Object]
});

const Person = mongoose.model('Person', personSchema);
module.exports = Person;

// Usage elsewhere:
const Person = require('./models/Person');
const person = await Person.findById(id);
```

### ✅ DO: Identity Resolution
```javascript
// ✅ DO: Use Sales Navigator ID or Numeric ID
async function resolveIdentity(webhookData) {
  const stableId = webhookData.salesNavId || webhookData.numericId;

  if (!stableId) {
    logger.warn('Webhook received with no stable ID', {
      profileUrl: webhookData.profileUrl
    });
    // Move to pending_identity collection
    await PendingIdentity.create(webhookData);
    return null;
  }

  return stableId;
}

// ❌ DON'T: Use profile URLs as identity
async function resolveIdentity(webhookData) {
  const id = webhookData.profileUrl; // URLs change!
  return id;
}
```

### ✅ DO: Observation-Snapshot Pattern
```javascript
// ✅ DO: Append observations, update snapshot
async function processObservation(webhookData) {
  const stableId = await resolveIdentity(webhookData);
  if (!stableId) return null;

  let person = await Person.findById(stableId);

  if (!person) {
    // First observation: create new person
    person = new Person({
      _id: stableId,
      salesNavId: webhookData.salesNavId,
      observations: [webhookData],
      snapshot: buildSnapshot(webhookData)
    });
  } else {
    // Append observation, update snapshot
    person.observations.push(webhookData);
    person.snapshot = buildSnapshot(webhookData, person.snapshot);
  }

  await person.save();
  return person;
}

// ❌ DON'T: Overwrite observations or skip snapshot updates
async function processObservation(webhookData) {
  const person = await Person.findById(webhookData.profileUrl);
  person.observations = [webhookData]; // Lost history!
  await person.save();
  return person;
}
```

### ✅ DO: Role Timeline Arrays
```javascript
// ✅ DO: Store roles as timeline with overlaps
const personSchema = new mongoose.Schema({
  salesNavId: String,
  snapshot: {
    fullName: String,
    roles: [{
      title: String,
      companyId: String,
      companyName: String,
      startDate: Date,
      endDate: Date,
      isCurrent: Boolean
    }]
  }
});

// Adding a new role:
person.snapshot.roles.push({
  title: 'Senior Engineer',
  companyId: 'comp123',
  startDate: new Date('2024-01-01'),
  isCurrent: true
});
```

### ✅ DO: Input Validation
```javascript
// ✅ DO: Validate before processing
async function createObservation(data) {
  if (!data.salesNavId && !data.numericId) {
    throw new AppError('INVALID_INPUT', 'Stable ID required');
  }

  if (!data.timestamp) {
    throw new AppError('INVALID_INPUT', 'Timestamp required');
  }

  return await Observation.create(data);
}
```

### ✅ DO: Logging with Winston
```javascript
// ✅ DO: Use Winston logger, never console.log
const logger = require('./utils/logger');

logger.info('Webhook received', { salesNavId: data.salesNavId });
logger.warn('Missing stable ID', { profileUrl: data.profileUrl });
logger.error('Failed to process observation', { error: err.message });

// ❌ DON'T: Use console.log in production code
console.log('Webhook received'); // Remove before commit
```

### ✅ DO: Environment Variables
```javascript
// ✅ DO: Use process.env, never hardcode
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const API_KEY = process.env.DUXSOUP_API_KEY;

// ❌ DON'T: Hardcode secrets
const API_KEY = 'sk_live_abc123'; // NEVER commit this
```

## Code Style (Auto-formatted by Prettier)
- 2-space indentation
- Single quotes for strings
- Semicolons required
- Trailing commas in arrays/objects
- Don't fight Prettier - it runs on every Edit/Write

## Naming Conventions
- **Variables/Functions:** `camelCase` (e.g., `processWebhook`, `salesNavId`)
- **Classes/Models:** `PascalCase` (e.g., `Person`, `AppError`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `API_KEY`, `MAX_RETRIES`)
- **Files:** `kebab-case.js` or `camelCase.js`

## Pre-Commit Checklist
Before marking code changes as complete:
- [ ] All `async` functions use `await` (no `.then()`)
- [ ] Errors use `AppError` with error codes
- [ ] Models exported with PascalCase
- [ ] Identity uses Sales Navigator ID or Numeric ID (not URLs)
- [ ] Observation-Snapshot pattern followed correctly
- [ ] No `console.log` statements (use `logger`)
- [ ] No hardcoded secrets (use `process.env`)
- [ ] Input validation before processing
- [ ] Ran tests: `npm test -- <test-file>`
