const mockPersonUpdateMany = jest.fn();
const mockCompanyUpdateMany = jest.fn();

jest.mock("mongoose", () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/models/person", () => ({
  countDocuments: jest.fn(),
  collection: { updateMany: mockPersonUpdateMany },
}));

jest.mock("../src/models/company", () => ({
  countDocuments: jest.fn(),
  collection: { updateMany: mockCompanyUpdateMany },
}));

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  backfillHttpsUrls,
  parseArgs,
} = require("../scripts/backfillHttpsUrls");
const Person = require("../src/models/person");
const Company = require("../src/models/company");

describe("backfillHttpsUrls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("parseArgs()", () => {
    it("should default to dry-run mode", () => {
      const originalArgv = process.argv;
      process.argv = ["node", "script.js"];
      const args = parseArgs();
      expect(args.dryRun).toBe(true);
      expect(args.commit).toBe(false);
      process.argv = originalArgv;
    });

    it("should enable commit mode with --commit flag", () => {
      const originalArgv = process.argv;
      process.argv = ["node", "script.js", "--commit"];
      const args = parseArgs();
      expect(args.dryRun).toBe(false);
      expect(args.commit).toBe(true);
      process.argv = originalArgv;
    });
  });

  describe("dry-run mode", () => {
    it("should count records without modifying them", async () => {
      Person.countDocuments.mockResolvedValue(100);
      Company.countDocuments.mockResolvedValue(25);

      const stats = await backfillHttpsUrls({ dryRun: true, commit: false });

      expect(stats.personCount).toBe(100);
      expect(stats.companyCount).toBe(25);
      expect(stats.personUpdated).toBe(0);
      expect(stats.companyUpdated).toBe(0);
      expect(mockPersonUpdateMany).not.toHaveBeenCalled();
      expect(mockCompanyUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe("commit mode", () => {
    it("should update Person and Company records", async () => {
      Person.countDocuments.mockResolvedValue(50);
      Company.countDocuments.mockResolvedValue(10);
      mockPersonUpdateMany.mockResolvedValue({ modifiedCount: 50 });
      mockCompanyUpdateMany.mockResolvedValue({ modifiedCount: 10 });

      const stats = await backfillHttpsUrls({ dryRun: false, commit: true });

      expect(stats.personCount).toBe(50);
      expect(stats.personUpdated).toBe(50);
      expect(stats.companyCount).toBe(10);
      expect(stats.companyUpdated).toBe(10);
      expect(mockPersonUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockCompanyUpdateMany).toHaveBeenCalledTimes(1);
    });

    it("should use aggregation pipeline for Person updates", async () => {
      Person.countDocuments.mockResolvedValue(5);
      Company.countDocuments.mockResolvedValue(0);
      mockPersonUpdateMany.mockResolvedValue({ modifiedCount: 5 });

      await backfillHttpsUrls({ dryRun: false, commit: true });

      const call = mockPersonUpdateMany.mock.calls[0];
      // First arg: filter with $regex string (native driver)
      expect(call[0]["snapshot.companyWebsite"]).toBeDefined();
      // Second arg: aggregation pipeline array
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[1][0].$set["snapshot.companyWebsite"]).toBeDefined();
      expect(
        call[1][0].$set["snapshot._meta.companyWebsite.value"],
      ).toBeDefined();
    });

    it("should use aggregation pipeline for Company updates", async () => {
      Person.countDocuments.mockResolvedValue(0);
      Company.countDocuments.mockResolvedValue(3);
      mockCompanyUpdateMany.mockResolvedValue({ modifiedCount: 3 });

      await backfillHttpsUrls({ dryRun: false, commit: true });

      const call = mockCompanyUpdateMany.mock.calls[0];
      expect(call[0]["snapshot.website"]).toBeDefined();
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[1][0].$set["snapshot.website"]).toBeDefined();
      expect(call[1][0].$set["snapshot._meta.website.value"]).toBeDefined();
    });

    it("should skip updateMany when count is 0", async () => {
      Person.countDocuments.mockResolvedValue(0);
      Company.countDocuments.mockResolvedValue(0);

      const stats = await backfillHttpsUrls({ dryRun: false, commit: true });

      expect(stats.personUpdated).toBe(0);
      expect(stats.companyUpdated).toBe(0);
      expect(mockPersonUpdateMany).not.toHaveBeenCalled();
      expect(mockCompanyUpdateMany).not.toHaveBeenCalled();
    });
  });
});
