jest.mock("../../src/utils/database", () => ({
  connect: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => {
  const mock = {
    find: jest.fn(),
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  };
  return mock;
});

const DeadLetter = require("../../src/models/deadLetter");
const {
  isFixedError,
  resurrectDeadLetters,
} = require("../../scripts/resurrectDeadLetters");

function setupFind(records) {
  const sortable = [...records];
  sortable.sort = jest.fn().mockReturnThis();
  sortable.limit = jest.fn().mockReturnValue(records);
  DeadLetter.find.mockReturnValue(sortable);
}

function makeDL(id, errorMessage, attempts = 10) {
  return {
    _id: id,
    observation_id: `obs-${id}`,
    error: { message: errorMessage },
    last_replay_error: null,
    replay_attempts: attempts,
    status: "permanently_failed",
  };
}

describe("resurrectDeadLetters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isFixedError()", () => {
    it("should match Cast to string failed errors", () => {
      expect(
        isFixedError("Cast to string failed for value \"{ text: 'MBA' }\""),
      ).toBe(true);
    });

    it("should match case-insensitively", () => {
      expect(isFixedError("cast to string failed for value XYZ")).toBe(true);
    });

    it("should match Cast to String (capitalized) variant", () => {
      expect(
        isFixedError("Cast to String failed for value \"{ text: 'PhD' }\""),
      ).toBe(true);
    });

    it("should NOT match unrelated permanent errors", () => {
      expect(
        isFixedError("E11000 duplicate key error collection: people"),
      ).toBe(false);
    });

    it("should NOT match transient errors", () => {
      expect(isFixedError("MongoNetworkError: connect ECONNREFUSED")).toBe(
        false,
      );
    });

    it("should return false for null/undefined/empty", () => {
      expect(isFixedError(null)).toBe(false);
      expect(isFixedError(undefined)).toBe(false);
      expect(isFixedError("")).toBe(false);
    });
  });

  describe("resurrectDeadLetters()", () => {
    it("should identify fixable errors for resurrection in dry-run", async () => {
      setupFind([
        makeDL("dl-1", "Cast to string failed for value \"{ text: 'MBA' }\""),
        makeDL("dl-2", "E11000 duplicate key error collection: people"),
        makeDL(
          "dl-3",
          "Cast to string failed for value \"{ text: 'Stanford' }\"",
        ),
      ]);

      const stats = await resurrectDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(stats.resurrected).toBe(2);
      expect(stats.skipped).toBe(1);
      expect(DeadLetter.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it("should reset status to pending with errorClass transient when not in dry-run", async () => {
      setupFind([
        makeDL("dl-1", "Cast to string failed for value \"{ text: 'MBA' }\""),
      ]);

      const stats = await resurrectDeadLetters({
        dryRun: false,
        managedConnection: true,
      });

      expect(stats.resurrected).toBe(1);
      expect(DeadLetter.findByIdAndUpdate).toHaveBeenCalledWith("dl-1", {
        status: "pending",
        replay_attempts: 0,
        next_replay_at: null,
        last_replay_error: expect.stringContaining("Resurrected:"),
        errorClass: "transient",
      });
    });

    it("should return zero resurrected when no dead letters exist", async () => {
      setupFind([]);

      const stats = await resurrectDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(stats.total).toBe(0);
      expect(stats.resurrected).toBe(0);
      expect(stats.skipped).toBe(0);
    });

    it("should skip non-matching errors", async () => {
      setupFind([
        makeDL("dl-1", "E11000 duplicate key error"),
        makeDL("dl-2", "invalid _id format: bad-id"),
      ]);

      const stats = await resurrectDeadLetters({
        dryRun: false,
        managedConnection: true,
      });

      expect(stats.resurrected).toBe(0);
      expect(stats.skipped).toBe(2);
      expect(DeadLetter.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it("should use last_replay_error when error.message is absent", async () => {
      setupFind([
        {
          _id: "dl-1",
          observation_id: "obs-dl-1",
          error: {},
          last_replay_error:
            "Cast to string failed for value \"{ text: 'PhD' }\"",
          replay_attempts: 10,
          status: "permanently_failed",
        },
      ]);

      const stats = await resurrectDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(stats.resurrected).toBe(1);
    });

    it("should support custom pattern override", async () => {
      setupFind([
        makeDL("dl-1", "invalid _id format: flávia-silva/en"),
        makeDL("dl-2", "Cast to string failed for value \"{ text: 'MBA' }\""),
      ]);

      const stats = await resurrectDeadLetters({
        dryRun: true,
        managedConnection: true,
        pattern: "invalid _id",
      });

      // Custom pattern matches only the _id error, not the Cast to string
      expect(stats.resurrected).toBe(1);
      expect(stats.skipped).toBe(1);
    });

    it("should track error breakdown in stats", async () => {
      setupFind([
        makeDL("dl-1", "Cast to string failed for value A"),
        makeDL("dl-2", "Cast to string failed for value B"),
      ]);

      const stats = await resurrectDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(Object.keys(stats.errorBreakdown).length).toBeGreaterThanOrEqual(
        1,
      );
      expect(stats.resurrected).toBe(2);
    });

    it("should only query permanently_failed dead letters", async () => {
      setupFind([]);

      await resurrectDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(DeadLetter.find).toHaveBeenCalledWith({
        status: "permanently_failed",
      });
    });

    it("should reset replay_attempts to 0 and set errorClass transient on resurrection", async () => {
      setupFind([makeDL("dl-1", "Cast to string failed for value X", 10)]);

      await resurrectDeadLetters({
        dryRun: false,
        managedConnection: true,
      });

      expect(DeadLetter.findByIdAndUpdate).toHaveBeenCalledWith(
        "dl-1",
        expect.objectContaining({
          replay_attempts: 0,
          errorClass: "transient",
        }),
      );
    });
  });
});
