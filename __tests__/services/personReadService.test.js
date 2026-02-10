jest.mock("../../src/models/person", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Person = require("../../src/models/person");
const { findPeopleByAliases } = require("../../src/services/personReadService");

describe("personReadService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findPeopleByAliases()", () => {
    it("should return matched people by alias value", async () => {
      const person1 = {
        _id: "id1",
        aliases: [{ type: "salesNavId", value: "ACwAAA111" }],
      };
      const person2 = {
        _id: "id2",
        aliases: [{ type: "numericId", value: "99999999" }],
      };
      Person.find.mockReturnValue({
        lean: () => Promise.resolve([person1, person2]),
      });

      const result = await findPeopleByAliases(["ACwAAA111", "99999999"]);

      expect(result.get("ACwAAA111")).toEqual(person1);
      expect(result.get("99999999")).toEqual(person2);
    });

    it("should return empty map when no matches found", async () => {
      Person.find.mockReturnValue({ lean: () => Promise.resolve([]) });

      const result = await findPeopleByAliases(["nonexistent"]);

      expect(result.size).toBe(0);
    });

    it("should map multiple aliases of the same person", async () => {
      const person = {
        _id: "id1",
        aliases: [
          { type: "salesNavId", value: "ACwAAA111" },
          { type: "numericId", value: "99999999" },
        ],
      };
      Person.find.mockReturnValue({ lean: () => Promise.resolve([person]) });

      const result = await findPeopleByAliases(["ACwAAA111", "99999999"]);

      expect(result.get("ACwAAA111")).toEqual(person);
      expect(result.get("99999999")).toEqual(person);
    });

    it("should use $in query on aliases.value", async () => {
      Person.find.mockReturnValue({ lean: () => Promise.resolve([]) });

      await findPeopleByAliases(["val1", "val2"]);

      expect(Person.find).toHaveBeenCalledWith({
        "aliases.value": { $in: ["val1", "val2"] },
      });
    });
  });
});
