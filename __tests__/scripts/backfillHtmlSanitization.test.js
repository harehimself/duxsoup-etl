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
  backfillHtmlSanitization,
  parseArgs,
} = require("../../scripts/backfillHtmlSanitization");

function setupFind(records) {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(records),
  };
  Person.find.mockReturnValue(chainable);
}

function makePerson(id, summary, roles = []) {
  return {
    _id: id,
    snapshot: { summary, roles },
  };
}

const defaultArgs = { dryRun: true, limit: 1000, batchSize: 100, target: null };

describe("backfillHtmlSanitization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("parseArgs()", () => {
    it("should default to dry-run mode", () => {
      const origArgv = process.argv;
      process.argv = ["node", "script.js"];
      const args = parseArgs();
      expect(args.dryRun).toBe(true);
      expect(args.commit).toBe(false);
      process.argv = origArgv;
    });
  });

  it("should count records needing HTML stripping in dry-run", async () => {
    setupFind([
      makePerson("p1", "<p>Summary with HTML</p>"),
      makePerson("p2", "Plain text summary"),
    ]);

    const stats = await backfillHtmlSanitization(defaultArgs);

    expect(stats.processed).toBe(2);
    expect(stats.summaryUpdated).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(Person.updateOne).not.toHaveBeenCalled();
  });

  it("should update summary and _meta in commit mode", async () => {
    setupFind([makePerson("p1", "<p>Summary</p>")]);

    const stats = await backfillHtmlSanitization({
      ...defaultArgs,
      dryRun: false,
      commit: true,
    });

    expect(stats.summaryUpdated).toBe(1);
    expect(Person.updateOne).toHaveBeenCalledWith(
      { _id: "p1" },
      {
        $set: {
          "snapshot.summary": "Summary",
          "snapshot._meta.summary.value": "Summary",
        },
      },
    );
  });

  it("should strip HTML from role descriptions", async () => {
    setupFind([
      makePerson("p1", null, [
        { title: "Engineer", description: "<li>Built things</li>" },
        { title: "Manager", description: "No HTML here" },
      ]),
    ]);

    const stats = await backfillHtmlSanitization({
      ...defaultArgs,
      dryRun: false,
      commit: true,
    });

    expect(stats.rolesUpdated).toBe(1);
    expect(Person.updateOne).toHaveBeenCalledWith(
      { _id: "p1" },
      {
        $set: {
          "snapshot.roles": expect.arrayContaining([
            expect.objectContaining({ description: "Built things" }),
            expect.objectContaining({ description: "No HTML here" }),
          ]),
        },
      },
    );
  });

  it("should skip records with no HTML to strip", async () => {
    setupFind([makePerson("p1", "Clean summary")]);

    const stats = await backfillHtmlSanitization(defaultArgs);

    expect(stats.skipped).toBe(1);
    expect(stats.summaryUpdated).toBe(0);
  });

  it("should handle update errors per record", async () => {
    setupFind([
      makePerson("p1", "<b>Bold</b>"),
      makePerson("p2", "<i>Italic</i>"),
    ]);
    Person.updateOne
      .mockRejectedValueOnce(new Error("DB error"))
      .mockResolvedValueOnce({ modifiedCount: 1 });

    const stats = await backfillHtmlSanitization({
      ...defaultArgs,
      dryRun: false,
      commit: true,
    });

    expect(stats.failed).toBe(1);
    expect(stats.summaryUpdated).toBe(2); // Both counted as needing update
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to strip HTML",
      expect.objectContaining({
        person_id: "p1",
        error: "DB error",
      }),
    );
  });

  it("should handle both summary and roles in same record", async () => {
    setupFind([
      makePerson("p1", "<p>HTML summary</p>", [
        { title: "Dev", description: "<b>HTML desc</b>" },
      ]),
    ]);

    const stats = await backfillHtmlSanitization({
      ...defaultArgs,
      dryRun: false,
      commit: true,
    });

    expect(stats.summaryUpdated).toBe(1);
    expect(stats.rolesUpdated).toBe(1);
    expect(Person.updateOne).toHaveBeenCalledTimes(1);
  });

  it("should skip roles with null or empty descriptions", async () => {
    setupFind([
      makePerson("p1", null, [
        { title: "Engineer", description: null },
        { title: "Manager", description: "" },
      ]),
    ]);

    const stats = await backfillHtmlSanitization(defaultArgs);

    expect(stats.skipped).toBe(1);
    expect(stats.rolesUpdated).toBe(0);
  });
});
