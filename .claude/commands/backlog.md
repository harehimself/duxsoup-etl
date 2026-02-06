Review the project backlog and help select the next task to work on.

## Steps

1. Read `.claude/BACKLOG.md` in full.
2. Identify all **open** (unchecked) items across priority tiers.
3. For each open item, assess:
   - **Complexity**: Low / Medium / High (based on files involved and scope)
   - **Risk**: Low / Medium / High (based on impact on identity resolution, data integrity, or production)
   - **Dependencies**: Any blockers or prerequisites
4. If `$ARGUMENTS` is provided, filter or focus on items matching that keyword.

## Output Format

Present open items as a prioritized table:

| Priority | Item | Complexity | Risk | Key Files |
|----------|------|-----------|------|-----------|
| ... | ... | ... | ... | ... |

Then recommend which item to tackle next based on:
- Priority tier (medium before low)
- Complexity (prefer lower complexity for quick wins)
- Risk (flag high-risk items that need careful testing)

End with: "Ready to start on [recommended item]? Or pick a different one."
