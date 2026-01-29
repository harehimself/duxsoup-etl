# Contributing to DuxSoup ETL

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- npm

### Local Setup
```bash
# Clone the repository
git clone https://github.com/harehimself/duxsoup-etl.git
cd duxsoup-etl

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your MongoDB connection string

# Run in development mode
npm run dev
```

### Running Tests
```bash
# Full test suite
npm test

# Single test file
npm test -- path/to/test.js

# Watch mode (if configured)
npm run test:watch
```

## Development Guidelines

### Code Style
- Use `async/await` for asynchronous operations (no raw `.then()`)
- Use the `AppError` class for error handling
- Export Mongoose models using PascalCase
- Follow the Observation-Snapshot pattern for data

### Commit Messages
Use conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions/changes
- `chore:` Maintenance tasks
- `refactor:` Code refactoring

### Pull Request Process
1. Create a feature branch from `main`
2. Make your changes with tests
3. Ensure all tests pass: `npm test`
4. Submit a PR using the template
5. Address review feedback

### Testing Requirements
- New features **must** include tests in `__tests__/`
- Tests should cover happy path and error cases
- Integration tests for webhook processing

## Architecture Notes

### Key Patterns
- **Observations**: Append-only logs of raw DuxSoup webhooks
- **People Snapshots**: Canonical state derived from observations
- **Identity Resolution**: Use Sales Navigator ID or Numeric ID as primary keys

### Important Files
- Entry point: `src/index.js`
- Primary model: `src/models/visit.js`
- Webhook handler: `src/routes/` or `src/controllers/`

## Questions?
Open an issue for questions or discussions.
