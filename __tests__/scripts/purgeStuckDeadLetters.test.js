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
  isPermanentError,
  purgeStuckDeadLetters,
} = require("../../scripts/purgeStuckDeadLetters");

function setupFind(records) {
  const sortable = [...records];
  sortable.sort = jest.fn().mockReturnThis();
  sortable.limit = jest.fn().mockReturnValue(records);
  DeadLetter.find.mockReturnValue(sortable);
}

describe("purgeStuckDeadLetters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isPermanentError()", () => {
    it("should classify Cast to string errors as permanent", () => {
      expect(
        isPermanentError("Cast to string failed for value \"{ text: 'MBA' }\""),
      ).toBe(true);
    });

    it("should classify ValidationError as permanent", () => {
      expect(
        isPermanentError(
          "Person validation failed: snapshot.education.0.school: ValidationError",
        ),
      ).toBe(true);
    });

    it("should classify CastError as permanent", () => {
      expect(
        isPermanentError(
          'CastError: Cast to ObjectId failed for value "bad-id"',
        ),
      ).toBe(true);
    });

    it("should classify invalid _id as permanent", () => {
      expect(isPermanentError("invalid _id format: flávia-silva/en")).toBe(
        true,
      );
    });

    it("should classify E11000 duplicate key as permanent", () => {
      expect(
        isPermanentError(
          "E11000 duplicate key error collection: people index: _id_",
        ),
      ).toBe(true);
    });

    it("should classify Document failed validation as permanent", () => {
      expect(
        isPermanentError(
          "Document failed validation on field snapshot.education",
        ),
      ).toBe(true);
    });

    it("should NOT classify timeout errors as permanent", () => {
      expect(isPermanentError("MongoServerError: connection timed out")).toBe(
        false,
      );
    });

    it("should NOT classify connection errors as permanent", () => {
      expect(isPermanentError("MongoNetworkError: connect ECONNREFUSED")).toBe(
        false,
      );
    });

    it("should NOT classify generic errors as permanent", () => {
      expect(isPermanentError("Something unexpected happened")).toBe(false);
    });

    it("should return false for null/undefined/empty", () => {
      expect(isPermanentError(null)).toBe(false);
      expect(isPermanentError(undefined)).toBe(false);
      expect(isPermanentError("")).toBe(false);
    });
  });

  describe("purgeStuckDeadLetters()", () => {
    function makeDL(id, errorMessage, status = "pending") {
      return {
        _id: id,
        observation_id: `obs-${id}`,
        error: { message: errorMessage },
        last_replay_error: null,
        replay_attempts: 3,
        status,
      };
    }

    it("should identify permanent errors for purging in dry-run", async () => {
      setupFind([
        makeDL("dl-1", "Cast to string failed for value \"{ text: 'MBA' }\""),
        makeDL("dl-2", "MongoNetworkError: connect ECONNREFUSED"),
        makeDL("dl-3", "ValidationError: snapshot.education.0.school"),
      ]);

      const stats = await purgeStuckDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(stats.purged).toBe(2);
      expect(stats.skipped).toBe(1);
      expect(DeadLetter.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it("should update records when not in dry-run", async () => {
      setupFind([
        makeDL("dl-1", "Cast to string failed for value \"{ text: 'MBA' }\""),
      ]);

      const stats = await purgeStuckDeadLetters({
        dryRun: false,
        managedConnection: true,
      });

      expect(stats.purged).toBe(1);
      expect(DeadLetter.findByIdAndUpdate).toHaveBeenCalledWith("dl-1", {
        status: "permanently_failed",
        last_replay_error: expect.stringContaining("Purged:"),
        next_replay_at: null,
      });
    });

    it("should return zero purged when no dead letters exist", async () => {
      setupFind([]);

      const stats = await purgeStuckDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(stats.total).toBe(0);
      expect(stats.purged).toBe(0);
      expect(stats.skipped).toBe(0);
    });

    it("should skip dead letters with transient errors", async () => {
      setupFind([
        makeDL("dl-1", "MongoNetworkError: connect ECONNREFUSED"),
        makeDL("dl-2", "MongoServerError: connection timed out"),
      ]);

      const stats = await purgeStuckDeadLetters({
        dryRun: false,
        managedConnection: true,
      });

      expect(stats.purged).toBe(0);
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
          replay_attempts: 5,
          status: "failed_again",
        },
      ]);

      const stats = await purgeStuckDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(stats.purged).toBe(1);
    });

    it("should track error breakdown in stats", async () => {
      setupFind([
        makeDL("dl-1", "Cast to string failed for value A"),
        makeDL("dl-2", "Cast to string failed for value B"),
        makeDL("dl-3", "ValidationError: bad field"),
      ]);

      const stats = await purgeStuckDeadLetters({
        dryRun: true,
        managedConnection: true,
      });

      expect(Object.keys(stats.errorBreakdown).length).toBeGreaterThanOrEqual(
        2,
      );
      expect(stats.purged).toBe(3);
    });
  });
});
