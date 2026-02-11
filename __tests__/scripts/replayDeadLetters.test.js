jest.mock("../../src/utils/database", () => ({
  connect: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  findEligibleForReplay: jest.fn(),
  find: jest.fn(),
  markReplayed: jest.fn().mockResolvedValue(),
  markReplayFailed: jest.fn().mockResolvedValue(),
}));

jest.mock("../../src/models/visit", () => ({
  findById: jest.fn(),
}));

jest.mock("../../src/models/scan", () => ({
  findById: jest.fn(),
}));

jest.mock("../../src/controllers/personController", () => ({
  upsertFromObservation: jest.fn(),
}));

jest.mock("../../src/controllers/companyController", () => ({
  upsertCompanyFromObservation: jest.fn(),
}));

jest.mock("../../src/controllers/locationController", () => ({
  upsertLocationFromObservation: jest.fn(),
}));

const DeadLetter = require("../../src/models/deadLetter");
const Visit = require("../../src/models/visit");
const Scan = require("../../src/models/scan");
const {
  upsertFromObservation,
} = require("../../src/controllers/personController");
const {
  upsertCompanyFromObservation,
} = require("../../src/controllers/companyController");
const {
  upsertLocationFromObservation,
} = require("../../src/controllers/locationController");
const logger = require("../../src/utils/logger");

// replayDeadLetter mutates the module-level stats object, so we must
// re-require for each test to get a fresh stats baseline.
let replayDeadLetter;
let replayDeadLetters;

function freshRequire() {
  jest.isolateModules(() => {
    const mod = require("../../scripts/replayDeadLetters");
    replayDeadLetter = mod.replayDeadLetter;
    replayDeadLetters = mod.replayDeadLetters;
  });
}

function makeDL(overrides = {}) {
  return {
    _id: "dl-1",
    observation_id: "obs-1",
    sourceType: "visit",
    ...overrides,
  };
}

function makeObservation(id = "obs-1") {
  return { _id: id, id: "dux-123", "First Name": "Jane" };
}

describe("replayDeadLetters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freshRequire();
  });

  describe("replayDeadLetter()", () => {
    it("should call person, company, and location upserts when all succeed", async () => {
      const dl = makeDL();
      const obs = makeObservation();
      Visit.findById.mockResolvedValue(obs);
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue({ _id: "company-1" });
      upsertLocationFromObservation.mockResolvedValue({ _id: "location-1" });

      const result = await replayDeadLetter(dl, false);

      expect(result).toEqual({ success: true, person_id: "person-1" });
      expect(DeadLetter.markReplayed).toHaveBeenCalledWith("obs-1");
      expect(upsertCompanyFromObservation).toHaveBeenCalledWith(obs, "visit");
      expect(upsertLocationFromObservation).toHaveBeenCalledWith(obs, "visit");
    });

    it("should still mark replayed when company upsert throws", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockRejectedValue(new Error("company boom"));
      upsertLocationFromObservation.mockResolvedValue({ _id: "loc-1" });

      const result = await replayDeadLetter(dl, false);

      expect(result.success).toBe(true);
      expect(DeadLetter.markReplayed).toHaveBeenCalledWith("obs-1");
      expect(logger.warn).toHaveBeenCalledWith(
        "Company upsert failed during replay (non-blocking)",
        expect.objectContaining({ error: "company boom" }),
      );
    });

    it("should still mark replayed when location upsert throws", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue(null);
      upsertLocationFromObservation.mockRejectedValue(
        new Error("location boom"),
      );

      const result = await replayDeadLetter(dl, false);

      expect(result.success).toBe(true);
      expect(DeadLetter.markReplayed).toHaveBeenCalledWith("obs-1");
      expect(logger.warn).toHaveBeenCalledWith(
        "Location upsert failed during replay (non-blocking)",
        expect.objectContaining({ error: "location boom" }),
      );
    });

    it("should still mark replayed when both company and location throw", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockRejectedValue(new Error("c-err"));
      upsertLocationFromObservation.mockRejectedValue(new Error("l-err"));

      const result = await replayDeadLetter(dl, false);

      expect(result.success).toBe(true);
      expect(DeadLetter.markReplayed).toHaveBeenCalledWith("obs-1");
    });

    it("should NOT call company/location when person upsert throws", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockRejectedValue(new Error("person boom"));

      const result = await replayDeadLetter(dl, false);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("error");
      expect(DeadLetter.markReplayFailed).toHaveBeenCalledWith(
        "obs-1",
        expect.any(Error),
      );
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();
    });

    it("should NOT call company/location when person returns null", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue(null);

      const result = await replayDeadLetter(dl, false);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("upsert_returned_null");
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();
    });

    it("should skip all upserts in dry-run mode", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(makeObservation());

      const result = await replayDeadLetter(dl, true);

      expect(result).toEqual({ success: true, dry_run: true });
      expect(upsertFromObservation).not.toHaveBeenCalled();
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();
    });

    it("should skip when observation not found", async () => {
      const dl = makeDL();
      Visit.findById.mockResolvedValue(null);

      const result = await replayDeadLetter(dl, false);

      expect(result).toEqual({
        success: false,
        reason: "observation_not_found",
      });
      expect(upsertFromObservation).not.toHaveBeenCalled();
      expect(upsertCompanyFromObservation).not.toHaveBeenCalled();
      expect(upsertLocationFromObservation).not.toHaveBeenCalled();
    });

    it("should use Scan model when sourceType is scan", async () => {
      const dl = makeDL({ sourceType: "scan" });
      const obs = makeObservation();
      Scan.findById.mockResolvedValue(obs);
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation.mockResolvedValue(null);
      upsertLocationFromObservation.mockResolvedValue(null);

      await replayDeadLetter(dl, false);

      expect(Scan.findById).toHaveBeenCalledWith("obs-1");
      expect(Visit.findById).not.toHaveBeenCalled();
    });
  });

  describe("replayDeadLetters() stats", () => {
    it("should include all company/location counters in returned stats", async () => {
      const dl1 = makeDL({ _id: "dl-1", observation_id: "obs-1" });
      const dl2 = makeDL({ _id: "dl-2", observation_id: "obs-2" });
      DeadLetter.findEligibleForReplay.mockResolvedValue([dl1, dl2]);

      Visit.findById.mockResolvedValue(makeObservation());
      upsertFromObservation.mockResolvedValue({ _id: "person-1" });
      upsertCompanyFromObservation
        .mockResolvedValueOnce({ _id: "c-1" })
        .mockRejectedValueOnce(new Error("fail"));
      upsertLocationFromObservation
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ _id: "l-1" });

      const result = await replayDeadLetters({
        dryRun: false,
        managedConnection: true,
      });

      expect(result.succeeded).toBe(2);
      expect(result.companySucceeded).toBe(1);
      expect(result.companyFailed).toBe(1);
      expect(result.locationSucceeded).toBe(1);
      expect(result.locationFailed).toBe(1);
    });
  });
});
