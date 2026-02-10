const cron = require("node-cron");

// Mock dependencies before requiring scheduler
const mockStop = jest.fn();
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ stop: mockStop })),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
  countEligibleForReplay: jest.fn(),
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
    mockStop.mockClear();
    // Restore mock implementation cleared by clearAllMocks
    cron.schedule.mockImplementation(() => ({ stop: mockStop }));

    // Reset schedulerStarted state by re-requiring
    jest.isolateModules(() => {
      const mod = require("../../src/workers/scheduler");
      mod.startScheduler(true);
    });

    // Capture the dead letter replay job (first cron.schedule call)
    deadLetterJob = cron.schedule.mock.calls[0]?.[1];
  });

  describe("dead letter replay job", () => {
    it("should skip replay and log single line when no eligible dead letters", async () => {
      DeadLetter.countEligibleForReplay.mockResolvedValue(0);

      await deadLetterJob();

      expect(DeadLetter.countEligibleForReplay).toHaveBeenCalled();
      expect(replayDeadLetters).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Dead letter replay: 0 eligible, skipped",
      );
    });

    it("should run full replay when eligible dead letters exist", async () => {
      DeadLetter.countEligibleForReplay.mockResolvedValue(5);
      replayDeadLetters.mockResolvedValue({
        total: 5,
        processed: 5,
        succeeded: 4,
        failed: 1,
      });

      await deadLetterJob();

      expect(DeadLetter.countEligibleForReplay).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "Running scheduled dead letter replay",
        { eligibleCount: 5 },
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
      DeadLetter.countEligibleForReplay.mockRejectedValue(
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
      DeadLetter.countEligibleForReplay.mockResolvedValue(3);
      replayDeadLetters.mockRejectedValue(new Error("replay crashed"));

      await deadLetterJob();

      expect(logger.error).toHaveBeenCalledWith(
        "Scheduled dead letter replay failed",
        expect.objectContaining({ error: "replay crashed" }),
      );
    });
  });

  describe("stopScheduler()", () => {
    it("should call stop() on all scheduled cron tasks", () => {
      jest.isolateModules(() => {
        mockStop.mockClear();
        cron.schedule.mockClear();
        const mod = require("../../src/workers/scheduler");
        mod.startScheduler(true);
        const taskCount = cron.schedule.mock.calls.length;
        expect(taskCount).toBeGreaterThan(0);

        mod.stopScheduler();
        expect(mockStop).toHaveBeenCalledTimes(taskCount);
      });
    });

    it("should be safe to call when scheduler is not started", () => {
      jest.isolateModules(() => {
        mockStop.mockClear();
        const mod = require("../../src/workers/scheduler");
        // Don't start the scheduler — stopScheduler should be a no-op
        mod.stopScheduler();
        expect(mockStop).not.toHaveBeenCalled();
      });
    });

    it("should allow scheduler to be restarted after stop", () => {
      jest.isolateModules(() => {
        mockStop.mockClear();
        const localCron = require("node-cron");
        const mod = require("../../src/workers/scheduler");
        localCron.schedule.mockClear();
        mod.startScheduler(true);
        const firstCallCount = localCron.schedule.mock.calls.length;

        mod.stopScheduler();
        localCron.schedule.mockClear();

        mod.startScheduler(true);
        expect(localCron.schedule.mock.calls.length).toBe(firstCallCount);
      });
    });
  });
});
