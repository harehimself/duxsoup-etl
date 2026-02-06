// Mock mongoose first - before any require that touches models
jest.mock("mongoose", () => {
  const actualMongoose = jest.requireActual("mongoose");
  return {
    ...actualMongoose,
    model: jest.fn().mockReturnValue({}),
    connect: jest.fn(),
    Schema: actualMongoose.Schema,
  };
});

// Mock the Person model
jest.mock("../../src/models/person", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  searchPeople,
  fuzzySearchPeople,
  smartSearch,
} = require("../../src/services/searchService");
const Person = require("../../src/models/person");

function buildQueryMock(resolvedValue = []) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(resolvedValue),
  };
}

describe("SearchService", () => {
  describe("searchPeople()", () => {
    it("should throw INVALID_QUERY when query is null", async () => {
      await expect(searchPeople({ query: null })).rejects.toThrow(
        "Search query is required",
      );
    });

    it("should throw INVALID_QUERY when query is a number", async () => {
      await expect(searchPeople({ query: 123 })).rejects.toThrow(
        "Search query is required",
      );
    });

    it("should throw INVALID_QUERY when query is empty string", async () => {
      await expect(searchPeople({ query: "   " })).rejects.toThrow(
        "Search query cannot be empty",
      );
    });

    it("should throw INVALID_LIMIT when limit is 0", async () => {
      await expect(searchPeople({ query: "test", limit: 0 })).rejects.toThrow(
        "Limit must be a positive integer",
      );
    });

    it("should throw LIMIT_EXCEEDED when limit exceeds 100", async () => {
      await expect(searchPeople({ query: "test", limit: 101 })).rejects.toThrow(
        "Limit cannot exceed 100",
      );
    });

    it("should throw INVALID_SKIP when skip is negative", async () => {
      await expect(searchPeople({ query: "test", skip: -1 })).rejects.toThrow(
        "Skip must be a non-negative integer",
      );
    });

    it("should return results and metadata for a valid query", async () => {
      const mockDocs = [
        { _id: "person-1", snapshot: { fullName: "John Doe" } },
      ];
      const queryMock = buildQueryMock(mockDocs);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(1);

      const result = await searchPeople({ query: "john", limit: 20, skip: 0 });

      expect(Person.find).toHaveBeenCalledWith(
        { $text: { $search: "john" } },
        { score: { $meta: "textScore" } },
      );
      expect(queryMock.sort).toHaveBeenCalledWith({
        score: { $meta: "textScore" },
      });
      expect(queryMock.skip).toHaveBeenCalledWith(0);
      expect(queryMock.limit).toHaveBeenCalledWith(20);
      expect(result.results).toEqual(mockDocs);
      expect(result.metadata.query).toBe("john");
      expect(result.metadata.count).toBe(1);
      expect(result.metadata.totalCount).toBe(1);
      expect(result.metadata.hasMore).toBe(false);
    });

    it("should set hasMore=true when more results exist", async () => {
      const mockDocs = [{ _id: "p1" }, { _id: "p2" }];
      const queryMock = buildQueryMock(mockDocs);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(10);

      const result = await searchPeople({ query: "test", limit: 2, skip: 0 });

      expect(result.metadata.hasMore).toBe(true);
      expect(result.metadata.nextSkip).toBe(2);
    });

    it("should apply field projection when fields param provided", async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      await searchPeople({
        query: "test",
        fields: ["snapshot.fullName", "snapshot.currentTitle"],
      });

      expect(queryMock.select).toHaveBeenCalledWith(
        "snapshot.fullName snapshot.currentTitle",
      );
    });

    it("should use default limit of 20 when not specified", async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      const result = await searchPeople({ query: "test" });

      expect(queryMock.limit).toHaveBeenCalledWith(20);
      expect(result.metadata.limit).toBe(20);
    });
  });

  describe("fuzzySearchPeople()", () => {
    it("should throw INVALID_QUERY for empty query", async () => {
      await expect(fuzzySearchPeople({ query: "" })).rejects.toThrow(
        "Search query is required",
      );
    });

    it("should throw INVALID_QUERY for null query", async () => {
      await expect(fuzzySearchPeople({ query: null })).rejects.toThrow(
        "Search query is required",
      );
    });

    it("should build OR regex across snapshot fields", async () => {
      const queryMock = buildQueryMock([]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(0);

      await fuzzySearchPeople({ query: "john doe" });

      const callArgs = Person.find.mock.calls[0][0];
      expect(callArgs.$or).toHaveLength(3);
      expect(Object.keys(callArgs.$or[0])[0]).toBe("snapshot.fullName");
      expect(Object.keys(callArgs.$or[1])[0]).toBe("snapshot.currentTitle");
      expect(Object.keys(callArgs.$or[2])[0]).toBe("snapshot.currentCompany");
    });

    it("should return metadata with fuzzy=true", async () => {
      const queryMock = buildQueryMock([{ _id: "p1" }]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(1);

      const result = await fuzzySearchPeople({ query: "test", limit: 5 });

      expect(result.metadata.fuzzy).toBe(true);
      expect(result.metadata.count).toBe(1);
    });

    it("should return complete pagination metadata", async () => {
      const mockDocs = [{ _id: "p1" }, { _id: "p2" }];
      const queryMock = buildQueryMock(mockDocs);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(5);

      const result = await fuzzySearchPeople({
        query: "test",
        limit: 2,
        skip: 0,
      });

      expect(result.metadata).toEqual({
        query: "test",
        count: 2,
        totalCount: 5,
        limit: 2,
        skip: 0,
        hasMore: true,
        nextSkip: 2,
        fuzzy: true,
        message: "Using fuzzy matching (no exact text matches found)",
      });
    });

    it("should set hasMore=false when all results returned", async () => {
      const mockDocs = [{ _id: "p1" }];
      const queryMock = buildQueryMock(mockDocs);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(1);

      const result = await fuzzySearchPeople({ query: "test", limit: 20 });

      expect(result.metadata.hasMore).toBe(false);
      expect(result.metadata.nextSkip).toBeNull();
      expect(result.metadata.totalCount).toBe(1);
      expect(result.metadata.limit).toBe(20);
    });

    it("should apply skip for pagination", async () => {
      const queryMock = buildQueryMock([{ _id: "p3" }]);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(5);

      const result = await fuzzySearchPeople({
        query: "test",
        limit: 2,
        skip: 2,
      });

      expect(queryMock.skip).toHaveBeenCalledWith(2);
      expect(result.metadata.skip).toBe(2);
      expect(result.metadata.hasMore).toBe(true);
      expect(result.metadata.nextSkip).toBe(4);
    });
  });

  describe("smartSearch()", () => {
    it("should return text search results when they exist", async () => {
      const mockDocs = [{ _id: "p1" }];
      const queryMock = buildQueryMock(mockDocs);
      Person.find.mockReturnValue(queryMock);
      Person.countDocuments.mockResolvedValue(1);

      const result = await smartSearch({ query: "engineer" });

      expect(result.results).toEqual(mockDocs);
      expect(result.metadata.fuzzy).toBeUndefined();
    });

    it("should fall back to fuzzy search when text search returns 0", async () => {
      const textQueryMock = buildQueryMock([]);
      const fuzzyQueryMock = buildQueryMock([
        { _id: "p1", snapshot: { fullName: "Jane" } },
      ]);

      Person.find
        .mockReturnValueOnce(textQueryMock)
        .mockReturnValueOnce(fuzzyQueryMock);
      // First countDocuments call is for text search (0 results), second is for fuzzy search (1 result)
      Person.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      const result = await smartSearch({ query: "jane" });

      expect(result.metadata.fuzzy).toBe(true);
      expect(result.results).toHaveLength(1);
    });

    it("should return complete pagination envelope from fuzzy fallback", async () => {
      const textQueryMock = buildQueryMock([]);
      const fuzzyDocs = [{ _id: "p1" }, { _id: "p2" }];
      const fuzzyQueryMock = buildQueryMock(fuzzyDocs);

      Person.find
        .mockReturnValueOnce(textQueryMock)
        .mockReturnValueOnce(fuzzyQueryMock);
      Person.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(5);

      const result = await smartSearch({ query: "test", limit: 2, skip: 0 });

      expect(result.metadata.fuzzy).toBe(true);
      expect(result.metadata.limit).toBe(2);
      expect(result.metadata.totalCount).toBe(5);
      expect(result.metadata.hasMore).toBe(true);
      expect(result.metadata.nextSkip).toBe(2);
    });
  });
});
