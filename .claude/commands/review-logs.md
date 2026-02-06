Review the latest Render logs for the duxsoup service using the Render MCP tools.

## Steps

1. Use `mcp__render__list_services` to get the service ID for the `duxsoup` web service.
2. Fetch the **last 50 app logs** using `mcp__render__list_logs` with `direction: "backward"`.
3. Separately fetch **error and warn level logs** using `level: ["error", "warn"]` with `limit: 30`.
4. Summarize findings in a table:
   - **Timeframe**: Earliest and latest log timestamps
   - **Webhook volume**: Count of "Webhook received" entries and types (visit vs scan)
   - **Errors/Warnings**: List each unique error message with count and most recent timestamp
   - **Identity resolution**: Note any warnings about missing stable IDs
   - **Dead letters**: Note any dead letter entries
   - **Duplicates**: Count of `isDuplicate: true` entries
5. If `$ARGUMENTS` is provided, use it as a text filter pattern for the logs.

## Output Format

Provide a concise operational summary with:
- Overall health assessment (healthy / degraded / unhealthy)
- Key metrics (webhooks/min, error rate, duplicate rate)
- Any actionable issues requiring attention
