const cron = require("node-cron");

// Mock dependencies before requiring scheduler
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../scripts/replayDeadLetters", () => ({
  replayDeadLetters: jest.fn(),
}));

const logger = require("../../src/utils/logger");
const DeadLetter = require("../../src/models/deadLetter");
const { replayDeadLetters } = require("../../scripts/replayDeadLetters");

describe("Scheduler", () => {
  let deadLetterJob;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset schedulerStarted state by re-requiring
    jest.isolateModules(() => {
      const mod = require("../../src/workers/scheduler");
      mod.startScheduler(true);
    });

    // Capture the dead letter replay job (first cron.schedule call)
    deadLetterJob = cron.schedule.mock.calls[0]?.[1];
  });

  describe("dead letter replay job", () => {
    it("should skip replay and log single line when no pending dead letters", async () => {
      DeadLetter.countDocuments.mockResolvedValue(0);

      await deadLetterJob();

      expect(DeadLetter.countDocuments).toHaveBeenCalledWith({
        status: "pending",
      });
      expect(replayDeadLetters).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Dead letter replay: 0 pending, skipped",
      );
    });

    it("should run full replay when pending dead letters exist", async () => {
      DeadLetter.countDocuments.mockResolvedValue(5);
      replayDeadLetters.mockResolvedValue({
        total: 5,
        processed: 5,
        succeeded: 4,
        failed: 1,
      });

      await deadLetterJob();

      expect(DeadLetter.countDocuments).toHaveBeenCalledWith({
        status: "pending",
      });
      expect(logger.info).toHaveBeenCalledWith(
        "Running scheduled dead letter replay",
        { pendingCount: 5 },
      );
      expect(replayDeadLetters).toHaveBeenCalledWith({
        dryRun: false,
        limit: 100,
        managedConnection: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        "Scheduled dead letter replay complete",
        expect.objectContaining({ total: 5 }),
      );
    });

    it("should log error when count query fails", async () => {
      DeadLetter.countDocuments.mockRejectedValue(
        new Error("connection timeout"),
      );

      await deadLetterJob();

      expect(replayDeadLetters).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Scheduled dead letter replay failed",
        expect.objectContaining({ error: "connection timeout" }),
      );
    });

    it("should log error when replay throws", async () => {
      DeadLetter.countDocuments.mockResolvedValue(3);
      replayDeadLetters.mockRejectedValue(new Error("replay crashed"));

      await deadLetterJob();

      expect(logger.error).toHaveBeenCalledWith(
        "Scheduled dead letter replay failed",
        expect.objectContaining({ error: "replay crashed" }),
      );
    });
  });
});
