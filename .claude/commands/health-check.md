Run a comprehensive health check on the duxsoup-etl system using Render MCP tools.

## Steps

1. **Service Status**: Use `mcp__render__get_service` to check service status (suspended, plan, region, auto-deploy).
2. **Recent Deploys**: Use `mcp__render__list_deploys` (limit 3) to check recent deployment status and any failures.
3. **Resource Metrics**: Use `mcp__render__get_metrics` with `metricTypes: ["cpu_usage", "memory_usage", "http_request_count"]` for the last hour.
4. **Error Logs**: Use `mcp__render__list_logs` with `level: ["error"]` and `limit: 20` to check for recent errors.
5. **Dead Letter Logs**: Use `mcp__render__list_logs` with `text: ["dead"]` and `limit: 10` to check for dead letter activity.

## Output Format

Present a dashboard-style summary:

```
Service: duxsoup | Status: _____ | Plan: _____ | Region: _____
Last Deploy: _____ | Status: _____

Resources (last 1h):
  CPU:    avg ___% | peak ___%
  Memory: avg ___MB | peak ___MB
  HTTP:   ___ requests

Error Summary:
  Errors (1h):      ___
  Dead Letters (1h): ___

Recent Issues:
  - [list any errors or concerns]
```

If any metric is concerning (CPU > 80%, memory > 80%, error rate > 5%), flag it explicitly.
