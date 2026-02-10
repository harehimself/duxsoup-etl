jest.mock("../../src/services/personReadService", () => ({
  findPersonById: jest.fn(),
  findPersonByAlias: jest.fn(),
  findPeopleByAliases: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const personReadService = require("../../src/services/personReadService");
const {
  getPersonsByAliases,
} = require("../../src/controllers/personReadController");

function mockReqRes(body = {}) {
  const req = { body };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

describe("personReadController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPersonsByAliases()", () => {
    it("should return 400 when values is missing", async () => {
      const { req, res } = mockReqRes({});
      await getPersonsByAliases(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "VALIDATION_ERROR" }),
      );
    });

    it("should return 400 when values is not an array", async () => {
      const { req, res } = mockReqRes({ values: "not-array" });
      await getPersonsByAliases(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("array") }),
      );
    });

    it("should return 400 when values is empty", async () => {
      const { req, res } = mockReqRes({ values: [] });
      await getPersonsByAliases(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("empty") }),
      );
    });

    it("should return 400 when values exceeds max batch size", async () => {
      const values = Array.from({ length: 51 }, (_, i) => `alias-${i}`);
      const { req, res } = mockReqRes({ values });
      await getPersonsByAliases(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("exceeds"),
        }),
      );
    });

    it("should return all found people", async () => {
      const person1 = { _id: "id1", aliases: [{ value: "a1" }] };
      const person2 = { _id: "id2", aliases: [{ value: "a2" }] };
      const resultMap = new Map([
        ["a1", person1],
        ["a2", person2],
      ]);
      personReadService.findPeopleByAliases.mockResolvedValue(resultMap);

      const { req, res } = mockReqRes({ values: ["a1", "a2"] });
      await getPersonsByAliases(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          total: 2,
          found: 2,
          notFound: 0,
        }),
      );
    });

    it("should handle partial matches", async () => {
      const person1 = { _id: "id1", aliases: [{ value: "a1" }] };
      const resultMap = new Map([["a1", person1]]);
      personReadService.findPeopleByAliases.mockResolvedValue(resultMap);

      const { req, res } = mockReqRes({ values: ["a1", "a2"] });
      await getPersonsByAliases(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.found).toBe(1);
      expect(response.notFound).toBe(1);
      expect(response.results[1].found).toBe(false);
      expect(response.results[1].person).toBeNull();
    });

    it("should handle no matches", async () => {
      personReadService.findPeopleByAliases.mockResolvedValue(new Map());

      const { req, res } = mockReqRes({ values: ["a1", "a2"] });
      await getPersonsByAliases(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.found).toBe(0);
      expect(response.notFound).toBe(2);
    });

    it("should deduplicate input values", async () => {
      personReadService.findPeopleByAliases.mockResolvedValue(new Map());

      const { req, res } = mockReqRes({ values: ["a1", "a1", "a2"] });
      await getPersonsByAliases(req, res);

      expect(personReadService.findPeopleByAliases).toHaveBeenCalledWith([
        "a1",
        "a2",
      ]);
      const response = res.json.mock.calls[0][0];
      expect(response.total).toBe(2);
    });

    it("should return 500 when service throws", async () => {
      personReadService.findPeopleByAliases.mockRejectedValue(
        new Error("DB error"),
      );

      const { req, res } = mockReqRes({ values: ["a1"] });
      await getPersonsByAliases(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "INTERNAL_ERROR" }),
      );
    });
  });
});
