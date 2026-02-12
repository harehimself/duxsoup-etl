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
  backfillPhoneNormalization,
} = require("../../scripts/backfillPhoneNormalization");

function setupFind(records) {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(records),
  };
  Person.find.mockReturnValue(chainable);
}

function makePerson(id, phone, countryCode = null) {
  const person = {
    _id: id,
    snapshot: { phone },
  };
  if (countryCode) {
    person.snapshot.countryCode = countryCode;
  }
  return person;
}

describe("backfillPhoneNormalization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should preview updates in dry-run mode", async () => {
    setupFind([makePerson("p1", "+1 (555) 123-4567")]);

    const stats = await backfillPhoneNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(1);
    expect(stats.updated).toBe(1);
    expect(Person.updateOne).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Would normalize phone",
      expect.objectContaining({
        person_id: "p1",
        from: "+1 (555) 123-4567",
        to: "+15551234567",
      }),
    );
  });

  it("should update phone and _meta in commit mode", async () => {
    setupFind([makePerson("p1", "(555) 123-4567")]);

    const stats = await backfillPhoneNormalization({
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
          "snapshot.phone": "+15551234567",
          "snapshot._meta.phone.value": "+15551234567",
        },
      },
    );
  });

  it("should skip already E.164 formatted records", async () => {
    setupFind([makePerson("p1", "+15551234567")]);

    const stats = await backfillPhoneNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.updated).toBe(0);
  });

  it("should skip records with null/empty phone", async () => {
    const person = { _id: "p1", snapshot: { phone: null } };
    setupFind([person]);

    const stats = await backfillPhoneNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.skipped).toBe(1);
    expect(stats.updated).toBe(0);
  });

  it("should use countryCode as default country when available", async () => {
    // French local number with FR country code
    setupFind([makePerson("p1", "06 12 34 56 78", "FR")]);

    const stats = await backfillPhoneNormalization({
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
          "snapshot.phone": "+33612345678",
          "snapshot._meta.phone.value": "+33612345678",
        },
      },
    );
  });

  it("should report accurate stats", async () => {
    setupFind([
      makePerson("p1", "+1 (555) 123-4567"),
      makePerson("p2", "+15559876543"),
      makePerson("p3", "555-999-0000"),
    ]);

    const stats = await backfillPhoneNormalization({
      dryRun: true,
      limit: 1000,
      batchSize: 100,
    });

    expect(stats.processed).toBe(3);
    expect(stats.updated).toBe(2); // p1 and p3 normalized
    expect(stats.skipped).toBe(1); // p2 already E.164
    expect(stats.failed).toBe(0);
  });

  it("should handle gracefully when countryCode is missing", async () => {
    // No countryCode — should fall back to US default
    setupFind([makePerson("p1", "(555) 123-4567")]);

    const stats = await backfillPhoneNormalization({
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
          "snapshot.phone": "+15551234567",
          "snapshot._meta.phone.value": "+15551234567",
        },
      },
    );
  });
});
