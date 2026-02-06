Debug identity resolution for a specific person or alias value.

**Usage**: `/debug-identity <alias-value-or-person-id>`

The argument `$ARGUMENTS` should be a Sales Nav ID, numeric ID, LinkedIn username, profile URL, or person _id.

## Steps

1. **Read the identity resolution code**:
   - `src/services/identityResolverService.js` — alias matching and merge logic
   - `src/utils/identityMatcher.js` — URL normalization, alias extraction
   - `src/utils/salesNavIdExtractor.js` — Sales Nav ID detection and extraction

2. **Trace the resolution path** for the given identifier:
   - Classify the identifier type (salesNavId, numericId, linkedInUsername, profileUrl, duxsoupId)
   - Show which regex patterns it matches or fails
   - Show the alias query that would be constructed
   - Identify any edge cases (case sensitivity, prefix-only matching, URL normalization)

3. **Check for known bugs** in `.claude/BACKLOG.md` that could affect this identifier.

4. **Show the resolution flow**:
   ```
   Input: <value>
   → Classified as: <type>
   → Alias query: { type: "<type>", value: "<normalized>" }
   → Case handling: <exact|case-insensitive>
   → Known risks: <any applicable backlog bugs>
   ```

5. If the identifier looks like it could be misclassified (e.g., username starting with ACwAA/ACoAA), explicitly flag the Sales Nav ID prefix bug.

## Output

Provide a clear trace of how the identity system would handle this value, including any gotchas or bugs that could affect resolution.
