const { MAX_RETRY_ATTEMPTS } = require("../../src/constants/limits");

// We test the model's static method logic by calling the real statics
// with mocked Mongoose primitives (findOne, findOneAndUpdate, find, countDocuments).
const DeadLetter = require("../../src/models/deadLetter");

describe("DeadLetter static methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("markReplayFailed()", () => {
    it("should set status to failed_again when under retry limit with transient error", async () => {
      jest
        .spyOn(DeadLetter, "findOne")
        .mockResolvedValue({ replay_attempts: 3 });
      jest
        .spyOn(DeadLetter, "findOneAndUpdate")
        .mockImplementation((_filter, update, _opts) => {
          return Promise.resolve({
            status: update.status,
            replay_attempts: update.replay_attempts,
            last_replay_error: update.last_replay_error,
            last_replay_at: update.last_replay_at,
            next_replay_at: update.next_replay_at,
            errorClass: update.errorClass,
          });
        });

      const result = await DeadLetter.markReplayFailed(
        "obs-1",
        new Error("connection timed out"),
      );

      expect(result.status).toBe("failed_again");
      expect(result.replay_attempts).toBe(4);
      expect(result.last_replay_error).toBe("connection timed out");
      expect(result.next_replay_at).toBeInstanceOf(Date);
      expect(result.errorClass).toBe("transient");
    });

    it("should set status to permanently_failed when reaching max retries", async () => {
      jest
        .spyOn(DeadLetter, "findOne")
        .mockResolvedValue({ replay_attempts: 9 });
      jest
        .spyOn(DeadLetter, "findOneAndUpdate")
        .mockImplementation((_filter, update, _opts) => {
          return Promise.resolve({
            status: update.status,
            replay_attempts: update.replay_attempts,
            last_replay_error: update.last_replay_error,
            last_replay_at: update.last_replay_at,
            next_replay_at: update.next_replay_at,
            errorClass: update.errorClass,
          });
        });

      const result = await DeadLetter.markReplayFailed(
        "obs-2",
        new Error("still broken"),
      );

      expect(result.status).toBe("permanently_failed");
      expect(result.replay_attempts).toBe(10);
      expect(result.next_replay_at).toBeNull();
      expect(result.errorClass).toBe("transient");
    });

    it("should fast-track permanent errors to permanently_failed on first attempt", async () => {
      jest
        .spyOn(DeadLetter, "findOne")
        .mockResolvedValue({ replay_attempts: 0 });
      jest
        .spyOn(DeadLetter, "findOneAndUpdate")
        .mockImplementation((_filter, update, _opts) => {
          return Promise.resolve({
            status: update.status,
            replay_attempts: update.replay_attempts,
            last_replay_error: update.last_replay_error,
            next_replay_at: update.next_replay_at,
            errorClass: update.errorClass,
          });
        });

      const result = await DeadLetter.markReplayFailed(
        "obs-perm",
        new Error("CastError: Cast to ObjectId failed"),
      );

      expect(result.status).toBe("permanently_failed");
      expect(result.replay_attempts).toBe(1);
      expect(result.next_replay_at).toBeNull();
      expect(result.errorClass).toBe("permanent");
    });

    it("should set errorClass to transient for transient errors", async () => {
      jest
        .spyOn(DeadLetter, "findOne")
        .mockResolvedValue({ replay_attempts: 2 });
      jest
        .spyOn(DeadLetter, "findOneAndUpdate")
        .mockImplementation((_filter, update, _opts) => {
          return Promise.resolve({
            status: update.status,
            errorClass: update.errorClass,
          });
        });

      const result = await DeadLetter.markReplayFailed(
        "obs-trans",
        new Error("MongoNetworkError: connect ECONNREFUSED"),
      );

      expect(result.status).toBe("failed_again");
      expect(result.errorClass).toBe("transient");
    });

    it("should compute next_replay_at via backoff for non-permanent failures", async () => {
      jest
        .spyOn(DeadLetter, "findOne")
        .mockResolvedValue({ replay_attempts: 2 });
      jest
        .spyOn(DeadLetter, "findOneAndUpdate")
        .mockImplementation((_filter, update, _opts) => {
          return Promise.resolve({
            status: update.status,
            replay_attempts: update.replay_attempts,
            last_replay_at: update.last_replay_at,
            next_replay_at: update.next_replay_at,
          });
        });

      const result = await DeadLetter.markReplayFailed(
        "obs-3",
        new Error("oops"),
      );

      expect(result.next_replay_at).toBeInstanceOf(Date);
      expect(result.next_replay_at.getTime()).toBeGreaterThan(
        result.last_replay_at.getTime(),
      );
    });

    it("should set next_replay_at to null for permanently failed records", async () => {
      jest
        .spyOn(DeadLetter, "findOne")
        .mockResolvedValue({ replay_attempts: MAX_RETRY_ATTEMPTS - 1 });
      jest
        .spyOn(DeadLetter, "findOneAndUpdate")
        .mockImplementation((_filter, update, _opts) => {
          return Promise.resolve({ next_replay_at: update.next_replay_at });
        });

      const result = await DeadLetter.markReplayFailed(
        "obs-4",
        new Error("done"),
      );

      expect(result.next_replay_at).toBeNull();
    });

    it("should return null when observation_id not found", async () => {
      jest.spyOn(DeadLetter, "findOne").mockResolvedValue(null);
      const updateSpy = jest.spyOn(DeadLetter, "findOneAndUpdate");

      const result = await DeadLetter.markReplayFailed(
        "nonexistent",
        new Error("x"),
      );

      expect(result).toBeNull();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe("findEligibleForReplay()", () => {
    it("should query with correct eligibility criteria including errorClass filter", async () => {
      const mockLimit = jest.fn().mockResolvedValue([]);
      const mockSort = jest.fn().mockReturnValue({ limit: mockLimit });
      jest.spyOn(DeadLetter, "find").mockReturnValue({ sort: mockSort });

      await DeadLetter.findEligibleForReplay(50);

      const query = DeadLetter.find.mock.calls[0][0];
      expect(query.status).toEqual({ $in: ["pending", "failed_again"] });
      expect(query.errorClass).toEqual({ $ne: "permanent" });
      expect(query.replay_attempts).toEqual({ $lt: MAX_RETRY_ATTEMPTS });
      expect(query.$or).toEqual(
        expect.arrayContaining([
          { next_replay_at: null },
          { next_replay_at: { $exists: false } },
          expect.objectContaining({ next_replay_at: expect.any(Object) }),
        ]),
      );
      expect(mockSort).toHaveBeenCalledWith({ createdAt: 1 });
      expect(mockLimit).toHaveBeenCalledWith(50);
    });

    it("should default to limit of 100", async () => {
      const mockLimit = jest.fn().mockResolvedValue([]);
      const mockSort = jest.fn().mockReturnValue({ limit: mockLimit });
      jest.spyOn(DeadLetter, "find").mockReturnValue({ sort: mockSort });

      await DeadLetter.findEligibleForReplay();

      expect(mockLimit).toHaveBeenCalledWith(100);
    });

    it("should sort by createdAt ascending (oldest first)", async () => {
      const mockLimit = jest.fn().mockResolvedValue([]);
      const mockSort = jest.fn().mockReturnValue({ limit: mockLimit });
      jest.spyOn(DeadLetter, "find").mockReturnValue({ sort: mockSort });

      await DeadLetter.findEligibleForReplay(10);

      expect(mockSort).toHaveBeenCalledWith({ createdAt: 1 });
    });
  });

  describe("countEligibleForReplay()", () => {
    it("should count with correct eligibility criteria including errorClass filter", async () => {
      jest.spyOn(DeadLetter, "countDocuments").mockResolvedValue(5);

      const count = await DeadLetter.countEligibleForReplay();

      expect(count).toBe(5);
      const query = DeadLetter.countDocuments.mock.calls[0][0];
      expect(query.status).toEqual({ $in: ["pending", "failed_again"] });
      expect(query.errorClass).toEqual({ $ne: "permanent" });
      expect(query.replay_attempts).toEqual({ $lt: MAX_RETRY_ATTEMPTS });
      expect(query.$or).toBeDefined();
    });
  });
});
