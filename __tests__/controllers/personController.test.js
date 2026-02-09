jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  updateRolesTimeline,
} = require("../../src/controllers/personController");
const logger = require("../../src/utils/logger");

/**
 * Helper: build a minimal person-like object for updateRolesTimeline
 */
function buildPersonDoc(overrides = {}) {
  return {
    _id: overrides._id || "ACwAAATest123",
    snapshot: {
      roles: [],
      ...(overrides.snapshot || {}),
    },
  };
}

describe("PersonController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("updateRolesTimeline()", () => {
    it("should nullify endDate when endDate < startDate", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "Engineer",
              Company: "Acme Corp",
              From: "2024-06-01",
              To: "2023-01-01", // endDate before startDate
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);

      const role = person.snapshot.roles[0];
      expect(role.startDate).toEqual(new Date("2024-06-01"));
      expect(role.endDate).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "Role has endDate before startDate, nullifying endDate",
        expect.objectContaining({
          person_id: "ACwAAATest123",
          title: "Engineer",
          company: "Acme Corp",
        }),
      );
    });

    it("should keep valid endDate when endDate >= startDate", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "Manager",
              Company: "Globex",
              From: "2023-01-01",
              To: "2024-06-01",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);

      const role = person.snapshot.roles[0];
      expect(role.startDate).toEqual(new Date("2023-01-01"));
      expect(role.endDate).toEqual(new Date("2024-06-01"));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should handle endDate equal to startDate", () => {
      const person = buildPersonDoc();
      const observationData = {
        extended: {
          positions: [
            {
              Title: "Intern",
              Company: "StartupCo",
              From: "2024-03-15",
              To: "2024-03-15",
            },
          ],
        },
      };

      const updated = updateRolesTimeline(person, observationData, {});

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(1);

      const role = person.snapshot.roles[0];
      expect(role.startDate).toEqual(new Date("2024-03-15"));
      expect(role.endDate).toEqual(new Date("2024-03-15"));
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
