# /quick-query - Run ad-hoc MongoDB queries

**Usage:** `/quick-query <natural language query>`

**Description:** Translates natural language into MongoDB queries and executes them, showing results in a readable format.

**Purpose:** Quick data exploration without writing scripts.

---

## Instructions for Claude

When this skill is invoked:

1. **Parse the natural language query** from args

2. **Translate to MongoDB query:**
   - Understand the user intent
   - Generate appropriate Mongoose query
   - Use proper model (Person, Visit, Scan, DeadLetter, Company, Location)
   - Apply filters, projections, sorts, limits as needed

3. **Execute query and format results:**
   - Connect to database
   - Run query
   - Format output in readable table or JSON
   - Show count and sample results
   - Disconnect

4. **Example translations:**

   Input: "How many people work at Google?"
   → `Person.countDocuments({ 'snapshot.currentCompany': /google/i })`

   Input: "Show me people added in the last 7 days"
   → `Person.find({ createdAt: { $gte: new Date(Date.now() - 7*24*60*60*1000) } }).limit(20)`

   Input: "Find people without Sales Nav IDs"
   → `Person.find({ 'aliases.type': { $ne: 'salesNavId' } }).limit(20)`

   Input: "What are the most common job titles?"
   → `Person.aggregate([{ $group: { _id: '$snapshot.currentTitle', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }])`

   Input: "Show recent visits"
   → `Visit.find({}).sort({ createdAt: -1 }).limit(10)`

5. **Output format:**
   ```
   QUICK QUERY
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Query: [original natural language]

   MongoDB Query:
   ─────────────────────────────────
   Person.countDocuments({
     'snapshot.currentCompany': /google/i
   })
   ─────────────────────────────────

   ✓ Result: 127 people

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

   Or for list results:
   ```
   QUICK QUERY
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Query: Show me people added in the last 7 days

   ✓ Found 15 results (showing first 10)

   ┌───┬────────────────────────┬──────────────────────┬─────────────────┐
   │ # │ Name                   │ Company              │ Added           │
   ├───┼────────────────────────┼──────────────────────┼─────────────────┤
   │ 1 │ John Doe               │ Google               │ 2 days ago      │
   │ 2 │ Jane Smith             │ Microsoft            │ 3 days ago      │
   │ 3 │ Bob Johnson            │ Amazon               │ 5 days ago      │
   └───┴────────────────────────┴──────────────────────┴─────────────────┘

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

6. **Supported query types:**
   - Counts: "how many...", "count..."
   - Filters: "people at...", "visits from...", "without..."
   - Aggregations: "most common...", "average...", "group by..."
   - Recent: "recent...", "latest...", "last N..."
   - Search: "find...", "show...", "list..."

7. **Safety limits:**
   - Default limit: 20 results (prevent overwhelming output)
   - For counts: no limit
   - User can override: "show all people at Google" → no limit
   - Warn if query might be slow

## Examples

```bash
/quick-query how many people have no observations?
/quick-query show people at Microsoft
/quick-query most common companies
/quick-query recent dead letters
/quick-query people in San Francisco
/quick-query visits in the last 24 hours
```

## Error Handling

- Ambiguous query: ask for clarification
- Invalid model/field: suggest corrections
- Database error: show clear message
- No results: confirm and suggest alternative queries
