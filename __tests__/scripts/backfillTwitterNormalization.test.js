jest.mock("mongoose", () => ({
  connect: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/person", () => {
  const mock = {
    find: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  return mock;
});

const Person = require("../../src/models/person");
const logger = require("../../src/utils/logger");
const {
  backfillTwitterNormalization,
} = require("../../scripts/backfillTwitterNormalization");

function setupFind(records) {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(records),
  };
  Person.find.mockReturnValue(chainable);
}

function makePerson(id, twitter) {
  return {
    _id: id,
    snapshot: { twitter },
  };
}

describe("backfillTwitterNormalization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should preview updates in dry-run mode", async () => {
    setupFind([makePerson("p1", "@JohnDoe")]);

    const stats = await backfillTwitterNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(1);
    expect(stats.updated).toBe(1);
    expect(Person.updateOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Would normalize twitter",
      expect.objectContaining({
        person_id: "p1",
        from: "@JohnDoe",
        to: "johndoe",
      }),
    );
  });

  it("should update twitter and _meta in commit mode", async () => {
    setupFind([makePerson("p1", "@JohnDoe")]);

    const stats = await backfillTwitterNormalization({
      dryRun: false,
      commit: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.updated).toBe(1);
    expect(Person.updateOne).toHaveBeenCalledWith(
      { _id: "p1" },
      {
        $set: {
          "snapshot.twitter": "johndoe",
          "snapshot._meta.twitter.value": "johndoe",
        },
      },
    );
  });

  it("should skip already-normalized handles", async () => {
    setupFind([makePerson("p1", "johndoe")]);

    const stats = await backfillTwitterNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.updated).toBe(0);
  });

  it("should skip records with null/empty twitter", async () => {
    const person = { _id: "p1", snapshot: { twitter: null } };
    setupFind([person]);

    const stats = await backfillTwitterNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.skipped).toBe(1);
    expect(stats.updated).toBe(0);
  });

  it("should normalize Twitter URLs", async () => {
    setupFind([makePerson("p1", "https://twitter.com/JaneDoe")]);

    const stats = await backfillTwitterNormalization({
      dryRun: false,
      commit: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.updated).toBe(1);
    expect(Person.updateOne).toHaveBeenCalledWith(
      { _id: "p1" },
      {
        $set: {
          "snapshot.twitter": "janedoe",
          "snapshot._meta.twitter.value": "janedoe",
        },
      },
    );
  });

  it("should report accurate stats", async () => {
    setupFind([
      makePerson("p1", "@JohnDoe"),
      makePerson("p2", "janedoe"),
      makePerson("p3", "https://x.com/BobSmith"),
    ]);

    const stats = await backfillTwitterNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(3);
    expect(stats.updated).toBe(2); // p1 and p3 normalized
    expect(stats.skipped).toBe(1); // p2 already normalized
    expect(stats.failed).toBe(0);
  });

  it("should handle update errors per record", async () => {
    setupFind([makePerson("p1", "@JohnDoe"), makePerson("p2", "@JaneDoe")]);
    Person.updateOne
      .mockRejectedValueOnce(new Error("DB error"))
      .mockResolvedValueOnce({ modifiedCount: 1 });

    const stats = await backfillTwitterNormalization({
      dryRun: false,
      commit: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.updated).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to normalize twitter",
      expect.objectContaining({
        person_id: "p1",
        error: "DB error",
      }),
    );
  });
});
