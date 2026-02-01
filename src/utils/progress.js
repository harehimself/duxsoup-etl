/**
 * Progress tracking utility for long-running scripts.
 *
 * Features:
 * - Percentage-based progress bar rendered to stderr
 * - Checkpoint-based resumability via a JSON state file
 * - ETA estimation based on elapsed time
 */

const fs = require('fs');
const path = require('path');

class ProgressTracker {
  /**
   * @param {Object} opts
   * @param {number} opts.total - Total items to process
   * @param {string} opts.label - Display label (e.g. "Merging duplicates")
   * @param {string} [opts.checkpointPath] - Path to checkpoint file for resumability
   * @param {number} [opts.reportEvery=50] - Log progress every N items
   */
  constructor({ total, label, checkpointPath, reportEvery = 50 }) {
    this.total = total;
    this.label = label;
    this.checkpointPath = checkpointPath;
    this.reportEvery = reportEvery;
    this.processed = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.skipped = 0;
    this.startTime = Date.now();
    this.checkpoint = null;
  }

  /**
   * Load checkpoint state from disk (if it exists).
   * @returns {Object|null} Previously saved state, or null if no checkpoint.
   */
  loadCheckpoint() {
    if (!this.checkpointPath) return null;
    try {
      if (fs.existsSync(this.checkpointPath)) {
        const raw = fs.readFileSync(this.checkpointPath, 'utf8');
        this.checkpoint = JSON.parse(raw);
        console.error(
          `Resuming from checkpoint: ${this.checkpoint.processed}/${this.total} already processed`,
        );
        this.processed = this.checkpoint.processed || 0;
        this.succeeded = this.checkpoint.succeeded || 0;
        this.failed = this.checkpoint.failed || 0;
        this.skipped = this.checkpoint.skipped || 0;
        return this.checkpoint;
      }
    } catch {
      // Corrupted checkpoint — start fresh
    }
    return null;
  }

  /**
   * Save current progress to the checkpoint file.
   * @param {Object} [extra] - Additional state to persist (e.g. lastProcessedId)
   */
  saveCheckpoint(extra = {}) {
    if (!this.checkpointPath) return;
    const state = {
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      skipped: this.skipped,
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    fs.writeFileSync(this.checkpointPath, JSON.stringify(state, null, 2));
  }

  /** Remove the checkpoint file (call when script completes successfully). */
  clearCheckpoint() {
    if (this.checkpointPath && fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }
  }

  /**
   * Record that one item was processed.
   * @param {'success'|'fail'|'skip'} outcome
   */
  tick(outcome = 'success') {
    this.processed++;
    if (outcome === 'success') this.succeeded++;
    else if (outcome === 'fail') this.failed++;
    else if (outcome === 'skip') this.skipped++;

    if (this.processed % this.reportEvery === 0 || this.processed === this.total) {
      this._render();
    }
  }

  /** Print a final summary to stderr. */
  finish() {
    this._render();
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.error('');
    console.error(`${this.label} complete — ${this.processed}/${this.total} in ${elapsed}s`);
    console.error(
      `  succeeded=${this.succeeded}  failed=${this.failed}  skipped=${this.skipped}`,
    );
  }

  /** @private Render a single progress line. */
  _render() {
    const pct = this.total > 0 ? ((this.processed / this.total) * 100).toFixed(1) : 0;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = this.processed > 0 ? (elapsed / this.processed) : 0;
    const remaining = rate > 0 ? ((this.total - this.processed) * rate).toFixed(0) : '?';

    const barLen = 30;
    const filled = Math.round((this.processed / Math.max(this.total, 1)) * barLen);
    const bar = '#'.repeat(filled) + '-'.repeat(barLen - filled);

    process.stderr.write(
      `\r  [${bar}] ${pct}% (${this.processed}/${this.total}) ETA ${remaining}s  `,
    );
  }
}

/**
 * Resolve the default checkpoint path for a given script name.
 * Stores checkpoints in the project's tmp/ directory.
 */
function defaultCheckpointPath(scriptName) {
  const dir = path.join(process.cwd(), 'tmp');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${scriptName}.checkpoint.json`);
}

module.exports = { ProgressTracker, defaultCheckpointPath };
