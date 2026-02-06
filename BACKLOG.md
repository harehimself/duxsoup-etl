# Backlog

| Priority | Task | Rationale | Owner | Status |
| --- | --- | --- | --- | --- |
| P1 | Tighten Sales Navigator ID detection to require full canonical format (e.g., `^AC[wo]AA[A-Z][A-Za-z0-9_-]+$`, case-insensitive) across identity resolution/matching and normalize case consistently. | Current prefix-only checks (`ACwAA`/`ACoAA`) can misclassify username-based `_id` values (e.g., `ACoAAlex`) as Sales Nav IDs, causing incorrect winner selection during merges. | — | Open |
