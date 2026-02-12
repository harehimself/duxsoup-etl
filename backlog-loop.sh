#!/bin/bash
set -e

# --- Config ---
ITEMS=5
BACKLOG_ADD=7
MAIN_BRANCH="master"
TIMESTAMP=$(date +%m%d-%H%M)

# Pre-approved tools
TOOLS="Read,Write,Bash(git *),Bash(npm test *),Bash(npm run lint *),Bash(cat *),Bash(ls *),Bash(mkdir *),Bash(find *),Bash(grep *)"

# --- Preflight ---
cd "$(git rev-parse --show-toplevel)"
git checkout "$MAIN_BRANCH" && git pull

echo "=========================================="
echo "Backlog Loop — $ITEMS items + $BACKLOG_ADD expansion"
echo "=========================================="

PR_URLS=()

# --- Process backlog items ---
for i in $(seq 1 "$ITEMS"); do
  FEAT_BRANCH="auto/backlog-${TIMESTAMP}-item-${i}"

  echo ""
  echo ">>> [$i/$ITEMS] Branch: $FEAT_BRANCH"
  echo "------------------------------------------"

  git checkout "$MAIN_BRANCH" && git pull
  git checkout -b "$FEAT_BRANCH"

  claude --print \
    --allowedTools "$TOOLS" \
    -p "
      You are working in the duxsoup-etl repo.

      Read .claude/BACKLOG.md in full. Identify all open (unchecked) items
      across priority tiers. Pick the highest-priority open item — prefer
      high before medium before low, and within a tier prefer lower complexity.

      Implement it fully. Run existing tests with npm test.

      When done:
      - Commit your code changes with a conventional commit (feat:/fix:/chore:).
      - Check off the item in .claude/BACKLOG.md (change [ ] to [x]).
      - Move it to the Completed section at the bottom with today's date
        and your commit ref, matching the existing format there.
      - Commit the BACKLOG.md update in the same commit or as a follow-up.

      Summarize what you did in 2-3 sentences at the end.
    "

  git push -u origin "$FEAT_BRANCH"
  PR_URL=$(gh pr create \
    --base "$MAIN_BRANCH" \
    --head "$FEAT_BRANCH" \
    --title "$(git log -1 --format='%s' -- ':!.claude/BACKLOG.md')" \
    --body "Automated backlog item $i/$ITEMS — $(date '+%Y-%m-%d %H:%M')" \
    2>&1 | tail -1)

  PR_URLS+=("$PR_URL")
  echo "PR created: $PR_URL"
done

# --- Merge all PRs sequentially ---
echo ""
echo "=========================================="
echo "Merging $ITEMS PRs to $MAIN_BRANCH"
echo "=========================================="

for url in "${PR_URLS[@]}"; do
  echo "Merging: $url"
  gh pr merge "$url" --squash --delete-branch
  sleep 2
done

git checkout "$MAIN_BRANCH" && git pull

# --- Backlog expansion ---
echo ""
echo "=========================================="
echo "Expanding backlog with $BACKLOG_ADD new items"
echo "=========================================="

EXPAND_BRANCH="auto/backlog-expand-${TIMESTAMP}"
git checkout -b "$EXPAND_BRANCH"

claude --print \
  --allowedTools "$TOOLS" \
  -p "
    You are working in the duxsoup-etl repo.

    Read the codebase structure and .claude/BACKLOG.md in full.
    Review the Completed section to understand what has already been done.

    Add exactly $BACKLOG_ADD new open items to the appropriate priority
    tiers (High / Medium / Low) in .claude/BACKLOG.md. Mix of features,
    bug fixes, and quality improvements. Match the existing format:

    - [ ] **Short title** — Description of the work.
      - Priority: \`high|medium|low\`
      - Category: \`feature|bug|reliability|cleanup|quality\`
      - Impact: One sentence on why this matters.

    Do not modify or remove any existing items.
    Commit with message 'chore: expand backlog with $BACKLOG_ADD new items'.
  "

git push -u origin "$EXPAND_BRANCH"
gh pr create \
  --base "$MAIN_BRANCH" \
  --head "$EXPAND_BRANCH" \
  --title "chore: expand backlog with $BACKLOG_ADD new items" \
  --body "Automated backlog expansion — $(date '+%Y-%m-%d %H:%M')"
gh pr merge "$EXPAND_BRANCH" --squash --delete-branch

echo ""
echo "=========================================="
echo "Done."
echo "  $ITEMS features implemented and merged"
echo "  $BACKLOG_ADD new backlog items added"
echo "  Review: gh pr list --state merged --limit 10"
echo "=========================================="
