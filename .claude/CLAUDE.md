# DuxSoup ETL & LinkedIn Intelligence

## Tech Stack & Commands
- Node.js / Express / MongoDB (Mongoose) / Jest
- Build: `npm run dev`
- Test: `npm test` (Full suite) | `npm test -- <path>` (Single file)
- Lint: `npm run lint`

## Architecture: LinkedIn Intelligence Layer
**Crucial: Follow the Observation-Snapshot Pattern**
- **Observations:** Append-only logs of raw DuxSoup webhooks. Source of truth for "what we saw."
- **People (Snapshots):** The canonical state. Updated *from* observations.
- **Identity:** Use `Sales Navigator ID` or `Numeric ID` as primary keys. **Never** rely on Profile URLs for identity.
- **Roles:** Store as a timeline array (start, end, company_id). Supports multiple concurrent roles.

## Code Style & Patterns
- **Async:** Always use `async/await`. No raw `.then()` blocks.
- **Errors:** Use the `AppError` class. Response format: `{ success: false, error: "CODE", message: "..." }`.
- **Models:** Export Mongoose models using PascalCase (e.g., `const Visit = ...`).
- **Tests:** New features **must** include a corresponding `.test.js` file in `tests/`.

## Agent Guidelines (Automation Rules)
1. **Always** run `npm test <file>` after modifying logic to ensure no regressions.
2. **Always** update `@docs/specs/` if changing the data schema.
3. **Never** commit secrets; use `process.env`.
4. **Identity Check:** If a webhook arrives without a stable ID, log a warning to Winston and move to a "pending_identity" collection.

## Important Context
- Entry: `src/index.js`
- Primary Model: `@src/models/visit.js`
- Custom Rules: `@.claude/rules/testing.md`
