jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require("../utils/logger");
const {
  shouldOverwrite,
  normalizeField,
  clearDerivedField,
  computeDerivedMetrics,
  updateRolesTimeline,
  updateEducation,
  updateSkills,
  coerceToString,
  upsertFromObservation: _upsertFromObservation,
} = require("../controllers/personController");
const _Person = require("../models/person");
const {
  connect: _connect,
  closeDatabase: _closeDatabase,
  clearDatabase: _clearDatabase,
} = require("./helpers/db");

describe("PersonController", () => {
  describe("shouldOverwrite()", () => {
    it("should accept when no existing value", () => {
      const existingMeta = null;
      const incomingMeta = {
        value: "John Doe",
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should reject empty incoming value", () => {
      const existingMeta = {
        value: "John Doe",
        observedAt: new Date("2024-01-01"),
        source: "scan",
      };
      const incomingMeta = {
        value: "",
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it("should allow visit to override scan (higher precedence)", () => {
      const existingMeta = {
        value: "San Francisco",
        observedAt: new Date("2024-01-15"),
        source: "scan",
      };
      const incomingMeta = {
        value: "New York",
        observedAt: new Date("2024-01-10"), // Older
        source: "visit", // Higher precedence
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should reject scan when visit exists (lower precedence)", () => {
      const existingMeta = {
        value: "New York",
        observedAt: new Date("2024-01-10"),
        source: "visit",
      };
      const incomingMeta = {
        value: "San Francisco",
        observedAt: new Date("2024-01-15"), // Newer
        source: "scan", // Lower precedence
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it("should allow newer visit to override older visit (same precedence)", () => {
      const existingMeta = {
        value: "Engineer",
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: "Senior Engineer",
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should reject older visit when newer exists", () => {
      const existingMeta = {
        value: "Senior Engineer",
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };
      const incomingMeta = {
        value: "Engineer",
        observedAt: new Date("2024-01-01"), // Older
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    // Tests for non-string values (bug fix for .trim() error)
    it("should accept incoming number value (connections, degree)", () => {
      const existingMeta = null;
      const incomingMeta = {
        value: 500, // Number, not string
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should overwrite existing with number value when higher precedence", () => {
      const existingMeta = {
        value: 250,
        observedAt: new Date("2024-01-01"),
        source: "scan",
      };
      const incomingMeta = {
        value: 500, // Number
        observedAt: new Date("2024-01-10"),
        source: "visit", // Higher precedence
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should reject null incoming value", () => {
      const existingMeta = {
        value: 500,
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: null, // Null value
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it("should reject undefined incoming value", () => {
      const existingMeta = {
        value: "John Doe",
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: undefined, // Undefined value
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it("should reject NaN incoming value", () => {
      const existingMeta = {
        value: 500,
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: NaN, // NaN value
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });

    it("should accept valid number 0 (zero connections is valid)", () => {
      const existingMeta = null;
      const incomingMeta = {
        value: 0, // Zero is a valid number
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should not treat existing 0 as empty (zero connections is a valid existing value)", () => {
      const existingMeta = {
        value: 0, // Existing zero — must be treated as a real value
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: 500,
        observedAt: new Date("2024-01-15"),
        source: "scan", // Lower precedence — should NOT overwrite
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false); // Scan cannot overwrite visit
    });

    it("should allow overwriting existing 0 with same-source newer value", () => {
      const existingMeta = {
        value: 0,
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: 100,
        observedAt: new Date("2024-01-15"),
        source: "visit", // Same source, newer — should overwrite
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(true);
    });

    it("should handle whitespace-only string as empty", () => {
      const existingMeta = {
        value: "John Doe",
        observedAt: new Date("2024-01-01"),
        source: "visit",
      };
      const incomingMeta = {
        value: "   ", // Whitespace only
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const result = shouldOverwrite(existingMeta, incomingMeta);

      expect(result).toBe(false);
    });
  });

  describe("normalizeField()", () => {
    it("should update field when incoming has higher precedence", () => {
      const snapshot = {
        location: "San Francisco",
        _meta: {
          location: {
            value: "San Francisco",
            observedAt: new Date("2024-01-01"),
            source: "scan",
          },
        },
      };

      const observationMeta = {
        observedAt: new Date("2024-01-15"),
        source: "visit",
        observation_id: "obs123",
      };

      const updated = normalizeField(
        snapshot,
        "location",
        "New York",
        observationMeta,
      );

      expect(updated).toBe(true);
      expect(snapshot.location).toBe("New York");
      expect(snapshot._meta.location.source).toBe("visit");
    });

    it("should not update field when incoming has lower precedence", () => {
      const snapshot = {
        location: "New York",
        _meta: {
          location: {
            value: "New York",
            observedAt: new Date("2024-01-15"),
            source: "visit",
          },
        },
      };

      const observationMeta = {
        observedAt: new Date("2024-01-20"),
        source: "scan",
        observation_id: "obs123",
      };

      const updated = normalizeField(
        snapshot,
        "location",
        "San Francisco",
        observationMeta,
      );

      expect(updated).toBe(false);
      expect(snapshot.location).toBe("New York"); // Unchanged
    });

    it("should not update field when incoming is empty", () => {
      const snapshot = {
        email: "john@example.com",
        _meta: {
          email: {
            value: "john@example.com",
            observedAt: new Date("2024-01-01"),
            source: "scan",
          },
        },
      };

      const observationMeta = {
        observedAt: new Date("2024-01-15"),
        source: "visit",
        observation_id: "obs123",
      };

      const updated = normalizeField(snapshot, "email", "", observationMeta);

      expect(updated).toBe(false);
      expect(snapshot.email).toBe("john@example.com"); // Unchanged
    });
  });

  describe("clearDerivedField()", () => {
    it("should clear an existing derived field and update _meta", () => {
      const snapshot = {
        parsedDepartment: "engineering",
        _meta: {
          parsedDepartment: {
            value: "engineering",
            observedAt: new Date("2024-01-01"),
            source: "visit",
            observationId: "obs-old",
          },
        },
      };

      const observationMeta = {
        observedAt: new Date("2024-02-01"),
        source: "visit",
        observationId: "obs-new",
      };

      const cleared = clearDerivedField(
        snapshot,
        "parsedDepartment",
        observationMeta,
      );

      expect(cleared).toBe(true);
      expect(snapshot.parsedDepartment).toBeNull();
      expect(snapshot._meta.parsedDepartment).toEqual({
        value: null,
        observedAt: new Date("2024-02-01"),
        source: "visit",
        observationId: "obs-new",
      });
    });

    it("should return false when field is already null", () => {
      const snapshot = {
        parsedDepartment: null,
        _meta: {},
      };

      const observationMeta = {
        observedAt: new Date("2024-02-01"),
        source: "visit",
        observationId: "obs-new",
      };

      const cleared = clearDerivedField(
        snapshot,
        "parsedDepartment",
        observationMeta,
      );

      expect(cleared).toBe(false);
    });

    it("should return false when field is undefined", () => {
      const snapshot = {
        _meta: {},
      };

      const observationMeta = {
        observedAt: new Date("2024-02-01"),
        source: "visit",
        observationId: "obs-new",
      };

      const cleared = clearDerivedField(
        snapshot,
        "parsedDepartment",
        observationMeta,
      );

      expect(cleared).toBe(false);
    });

    it("should initialize _meta if missing", () => {
      const snapshot = {
        parsedSeniority: "VP",
      };

      const observationMeta = {
        observedAt: new Date("2024-02-01"),
        source: "visit",
        observationId: "obs-new",
      };

      const cleared = clearDerivedField(
        snapshot,
        "parsedSeniority",
        observationMeta,
      );

      expect(cleared).toBe(true);
      expect(snapshot.parsedSeniority).toBeNull();
      expect(snapshot._meta).toBeDefined();
      expect(snapshot._meta.parsedSeniority.value).toBeNull();
    });

    it("should clear parsedDepartment when title changes from parsable to unparsable", () => {
      // Simulates the scenario: person had "VP of Engineering" (parsedSeniority: "VP",
      // parsedDepartment: "engineering"), title changes to "Retired"
      // (no department match, seniority becomes "Individual Contributor")
      const snapshot = {
        currentTitle: "Retired",
        parsedSeniority: "VP",
        parsedDepartment: "engineering",
        _meta: {
          currentTitle: {
            value: "VP of Engineering",
            observedAt: new Date("2024-01-01"),
            source: "visit",
          },
          parsedSeniority: {
            value: "VP",
            observedAt: new Date("2024-01-01"),
            source: "visit",
          },
          parsedDepartment: {
            value: "engineering",
            observedAt: new Date("2024-01-01"),
            source: "visit",
          },
        },
      };

      const observationMeta = {
        observedAt: new Date("2024-02-01"),
        source: "visit",
        observationId: "obs-new",
      };

      // parseTitle("Freelance Consultant") returns:
      //   seniority: "Individual Contributor", department: null
      const { parseTitle } = require("../../src/utils/titleParser");
      const parsed = parseTitle(snapshot.currentTitle);

      // Seniority is truthy ("Individual Contributor"), so normalizeField handles it
      normalizeField(
        snapshot,
        "parsedSeniority",
        parsed.seniority,
        observationMeta,
      );

      // Department is null, so clearDerivedField must handle it
      if (parsed.department) {
        normalizeField(
          snapshot,
          "parsedDepartment",
          parsed.department,
          observationMeta,
        );
      } else {
        clearDerivedField(snapshot, "parsedDepartment", observationMeta);
      }

      expect(snapshot.parsedSeniority).toBe("Individual Contributor");
      expect(snapshot.parsedDepartment).toBeNull();
      expect(snapshot._meta.parsedDepartment.value).toBeNull();
      expect(snapshot._meta.parsedDepartment.observedAt).toEqual(
        new Date("2024-02-01"),
      );
    });
  });

  describe("computeDerivedMetrics()", () => {
    it("should compute avg_tenure_months from roles", () => {
      const roles = [
        {
          title: "Engineer",
          startDate: new Date("2020-01-01"),
          endDate: new Date("2022-01-01"), // 24 months
          isCurrent: false,
        },
        {
          title: "Senior Engineer",
          startDate: new Date("2022-01-01"),
          endDate: new Date("2024-01-01"), // 24 months
          isCurrent: false,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      expect(metrics.avgTenureMonths).toBe(24);
    });

    it("should compute years_at_current_company for current role", () => {
      const roles = [
        {
          title: "Senior Engineer",
          startDate: new Date("2022-01-01"),
          endDate: null,
          isCurrent: true,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      expect(metrics.yearsAtCurrentCompany).toBeGreaterThan(2);
      expect(metrics.yearsAtCurrentCompany).toBeLessThan(5);
    });

    it("should return null metrics when no roles exist", () => {
      const roles = [];

      const metrics = computeDerivedMetrics(roles);

      expect(metrics.avgTenureMonths).toBeNull();
      expect(metrics.yearsAtCurrentCompany).toBeNull();
    });

    it("should handle multiple current roles (multi-current support)", () => {
      const roles = [
        {
          title: "Engineer at CompanyA",
          startDate: new Date("2022-01-01"),
          isCurrent: true,
        },
        {
          title: "Consultant at CompanyB",
          startDate: new Date("2023-06-01"),
          isCurrent: true,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      // Should use the longest current tenure
      expect(metrics.yearsAtCurrentCompany).toBeGreaterThan(2);
    });
  });

  describe("updateRolesTimeline()", () => {
    it("should add new role without deleting existing roles", () => {
      const person = {
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "OldCorp",
              startDate: new Date("2020-01-01"),
              endDate: new Date("2022-01-01"),
              isCurrent: false,
            },
          ],
        },
      };

      const observationData = {
        Title: "Senior Engineer",
        Company: "NewCorp",
        CompanyID: "12345",
        extended: {
          positions: [
            {
              Title: "Senior Engineer",
              Company: "NewCorp",
              From: "2022-01-01",
              To: "Present",
            },
          ],
        },
      };

      const observationMeta = {
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const updated = updateRolesTimeline(
        person,
        observationData,
        observationMeta,
      );

      expect(updated).toBe(true);
      expect(person.snapshot.roles).toHaveLength(2); // Old + new
      expect(person.snapshot.roles[0].companyName).toBe("OldCorp"); // Preserved
      expect(person.snapshot.roles[1].companyName).toBe("NewCorp"); // Added
    });

    it("should preserve multi-current roles", () => {
      const person = {
        snapshot: {
          roles: [
            {
              title: "Engineer at CompanyA",
              companyName: "CompanyA",
              isCurrent: true,
            },
            {
              title: "Consultant at CompanyB",
              companyName: "CompanyB",
              isCurrent: true,
            },
          ],
        },
      };

      const observationData = {
        Title: "Engineer at CompanyA",
        Company: "CompanyA",
      };

      const observationMeta = {
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const updated = updateRolesTimeline(
        person,
        observationData,
        observationMeta,
      );

      expect(updated).toBe(false); // No new roles added
      expect(person.snapshot.roles).toHaveLength(2); // Both preserved
      expect(person.snapshot.roles.filter((r) => r.isCurrent)).toHaveLength(2);
    });

    it("should not duplicate existing role", () => {
      const person = {
        snapshot: {
          roles: [
            {
              title: "Engineer",
              companyName: "TechCorp",
              startDate: new Date("2022-01-01"),
              isCurrent: true,
            },
          ],
        },
      };

      const observationData = {
        Title: "Engineer",
        Company: "TechCorp",
      };

      const observationMeta = {
        observedAt: new Date("2024-01-15"),
        source: "visit",
      };

      const updated = updateRolesTimeline(
        person,
        observationData,
        observationMeta,
      );

      expect(updated).toBe(false); // No update
      expect(person.snapshot.roles).toHaveLength(1); // Not duplicated
    });
  });

  describe("birthday field handling (via normalizeField + parseBirthdayDate)", () => {
    const { parseBirthdayDate } = require("../../src/utils/date-parser");

    it("should store Date when birthday has a year", () => {
      const snapshot = { _meta: {} };
      const observationMeta = {
        observedAt: new Date("2024-06-01"),
        source: "visit",
        observation_id: "obs1",
      };

      const { date } = parseBirthdayDate("March 14, 1990");
      const updated = normalizeField(
        snapshot,
        "birthday",
        date,
        observationMeta,
      );

      expect(updated).toBe(true);
      expect(snapshot.birthday).toBeInstanceOf(Date);
      expect(snapshot.birthday.getFullYear()).toBe(1990);
    });

    it("should store raw string when birthday lacks a year", () => {
      const snapshot = { _meta: {} };
      const observationMeta = {
        observedAt: new Date("2024-06-01"),
        source: "visit",
        observation_id: "obs1",
      };

      const { date, raw } = parseBirthdayDate("March 14");
      expect(date).toBeNull();
      expect(raw).toBe("March 14");

      // Controller logic: when date is null and raw is present,
      // skip normalizeField for birthday and store birthdayRaw instead
      const rawUpdated = normalizeField(
        snapshot,
        "birthdayRaw",
        raw,
        observationMeta,
      );
      expect(rawUpdated).toBe(true);
      expect(snapshot.birthdayRaw).toBe("March 14");
      expect(snapshot.birthday).toBeUndefined(); // never set
    });

    it("should not fabricate year 2001 for year-less birthday", () => {
      const { date } = parseBirthdayDate("January 5");
      // The critical assertion: no Date with a fabricated year
      expect(date).toBeNull();
    });

    it("should clear existing birthday Date when year-less birthday arrives", () => {
      // Simulate: snapshot already has a (possibly bogus) birthday Date
      const snapshot = {
        birthday: new Date("2001-03-14"),
        _meta: {
          birthday: {
            value: new Date("2001-03-14"),
            observedAt: new Date("2024-01-01"),
            source: "scan",
            observation_id: "old",
          },
        },
      };

      const { date, raw } = parseBirthdayDate("March 14");
      expect(date).toBeNull();
      expect(raw).toBe("March 14");

      // Controller logic: when raw is present, clear birthday and set birthdayRaw
      if (raw) {
        snapshot.birthday = null;
        delete snapshot._meta.birthday;
        const observationMeta = {
          observedAt: new Date("2024-06-01"),
          source: "visit",
          observation_id: "obs2",
        };
        normalizeField(snapshot, "birthdayRaw", raw, observationMeta);
      }

      expect(snapshot.birthday).toBeNull();
      expect(snapshot._meta.birthday).toBeUndefined();
      expect(snapshot.birthdayRaw).toBe("March 14");
    });
  });

  describe("snapshot deep clone preserves Date objects", () => {
    it("should preserve Date values when cloning with structuredClone", () => {
      const snapshot = {
        firstName: "Jane",
        currentTitle: "VP Engineering",
        _meta: {
          firstName: {
            value: "Jane",
            observedAt: new Date("2024-01-15T10:30:00Z"),
            source: "visit",
            observationId: "obs1",
          },
          currentTitle: {
            value: "VP Engineering",
            observedAt: new Date("2024-03-20T14:00:00Z"),
            source: "visit",
            observationId: "obs2",
          },
        },
      };

      const cloned = structuredClone(snapshot);

      // structuredClone preserves Date objects — getTime() works
      expect(typeof cloned._meta.firstName.observedAt.getTime).toBe("function");
      expect(cloned._meta.firstName.observedAt.getTime()).toBe(
        new Date("2024-01-15T10:30:00Z").getTime(),
      );
      expect(cloned._meta.currentTitle.observedAt.getTime()).toBe(
        new Date("2024-03-20T14:00:00Z").getTime(),
      );
    });

    it("should NOT preserve Date values with JSON.parse(JSON.stringify())", () => {
      const snapshot = {
        _meta: {
          firstName: {
            observedAt: new Date("2024-01-15T10:30:00Z"),
          },
        },
      };

      const cloned = JSON.parse(JSON.stringify(snapshot));

      // JSON clone converts Dates to strings — getTime() is not a function
      expect(typeof cloned._meta.firstName.observedAt).toBe("string");
      expect(cloned._meta.firstName.observedAt.getTime).toBeUndefined();
    });
  });

  describe("array cap enforcement", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe("updateRolesTimeline() caps", () => {
      it("should allow adding a role when below MAX_ROLES", () => {
        const person = {
          snapshot: {
            roles: Array.from({ length: 49 }, (_, i) => ({
              title: `Role ${i}`,
              companyName: `Company ${i}`,
              startDate: new Date(`${2000 + i}-01-01`),
              isCurrent: false,
            })),
          },
        };

        const observationData = {
          extended: {
            positions: [
              {
                Title: "New Role",
                Company: "NewCorp",
                From: "2024-01-01",
                To: "Present",
              },
            ],
          },
        };

        const updated = updateRolesTimeline(person, observationData, {});

        expect(updated).toBe(true);
        expect(person.snapshot.roles).toHaveLength(50);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("should drop role and log warning when at MAX_ROLES", () => {
        const person = {
          _id: "ACwAAATestPerson",
          snapshot: {
            roles: Array.from({ length: 50 }, (_, i) => ({
              title: `Role ${i}`,
              companyName: `Company ${i}`,
              startDate: new Date(`${2000 + i}-01-01`),
              isCurrent: false,
            })),
          },
        };

        const observationData = {
          extended: {
            positions: [
              {
                Title: "Overflow Role",
                Company: "OverflowCorp",
                From: "2024-06-01",
                To: "Present",
              },
            ],
          },
        };

        updateRolesTimeline(person, observationData, {});

        expect(person.snapshot.roles).toHaveLength(50);
        expect(logger.warn).toHaveBeenCalledWith(
          "Roles array at capacity, dropping new role",
          expect.objectContaining({
            person_id: "ACwAAATestPerson",
            currentCount: 50,
            maxRoles: 50,
            droppedRole: expect.objectContaining({
              title: "Overflow Role",
              company: "OverflowCorp",
            }),
          }),
        );
      });

      it("should cap at MAX_ROLES when observation has multiple new positions", () => {
        const person = {
          _id: "ACwAAATestPerson",
          snapshot: {
            roles: Array.from({ length: 48 }, (_, i) => ({
              title: `Role ${i}`,
              companyName: `Company ${i}`,
              startDate: new Date(`${2000 + i}-01-01`),
              isCurrent: false,
            })),
          },
        };

        const observationData = {
          extended: {
            positions: Array.from({ length: 5 }, (_, i) => ({
              Title: `New Role ${i}`,
              Company: `NewCorp ${i}`,
              From: `2024-0${i + 1}-01`,
              To: "Present",
            })),
          },
        };

        updateRolesTimeline(person, observationData, {});

        expect(person.snapshot.roles).toHaveLength(50);
        expect(logger.warn).toHaveBeenCalledTimes(3);
      });

      it("should not log warning for duplicate roles that are deduped", () => {
        const person = {
          _id: "ACwAAATestPerson",
          snapshot: {
            roles: Array.from({ length: 50 }, (_, i) => ({
              title: `Role ${i}`,
              companyName: `Company ${i}`,
              startDate: new Date(`${2000 + i}-01-01`),
              isCurrent: false,
            })),
          },
        };

        const observationData = {
          extended: {
            positions: [
              {
                Title: "Role 0",
                Company: "Company 0",
                From: "2000-01-01",
              },
            ],
          },
        };

        updateRolesTimeline(person, observationData, {});

        expect(person.snapshot.roles).toHaveLength(50);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("should cap single-role fallback when at MAX_ROLES", () => {
        const person = {
          _id: "ACwAAATestPerson",
          snapshot: {
            roles: Array.from({ length: 50 }, (_, i) => ({
              title: `Role ${i}`,
              companyName: `Company ${i}`,
              startDate: new Date(`${2000 + i}-01-01`),
              isCurrent: false,
            })),
          },
        };

        const observationData = {
          Title: "New Title",
          Company: "New Company",
        };

        updateRolesTimeline(person, observationData, {});

        expect(person.snapshot.roles).toHaveLength(50);
        expect(logger.warn).toHaveBeenCalledWith(
          "Roles array at capacity, dropping new role",
          expect.objectContaining({ maxRoles: 50 }),
        );
      });
    });

    describe("updateEducation() caps", () => {
      it("should add education entry when below cap", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [{ Name: "MIT", Degree: "BS", Field: "CS" }];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        expect(person.snapshot.education).toHaveLength(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("should drop entry and log warning when at MAX_EDUCATION", () => {
        const person = {
          _id: "test",
          snapshot: {
            education: Array.from({ length: 20 }, (_, i) => ({
              school: `School ${i}`,
              degree: "BS",
              field: `Field ${i}`,
            })),
          },
        };
        const schools = [
          { Name: "Overflow School", Degree: "PhD", Field: "Physics" },
        ];

        updateEducation(person, schools);

        expect(person.snapshot.education).toHaveLength(20);
        expect(logger.warn).toHaveBeenCalledWith(
          "Education array at capacity, dropping new entry",
          expect.objectContaining({ maxEducation: 20 }),
        );
      });

      it("should not trigger cap warning for duplicates", () => {
        const person = {
          _id: "test",
          snapshot: {
            education: [{ school: "MIT", degree: "BS", field: "CS" }],
          },
        };
        const schools = [{ Name: "MIT", Degree: "BS", Field: "CS" }];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(false);
        expect(person.snapshot.education).toHaveLength(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("should return false for empty or null schools", () => {
        const person = { _id: "test", snapshot: { education: [] } };

        expect(updateEducation(person, null)).toBe(false);
        expect(updateEducation(person, [])).toBe(false);
      });
    });

    describe("updateEducation() with object-typed fields", () => {
      it("should extract .text from object-typed school Name", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [
          {
            Name: { text: "MIT", textDirection: "ltr", attributesV2: [] },
            Degree: "BS",
            Field: "CS",
          },
        ];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        expect(person.snapshot.education[0].school).toBe("MIT");
        expect(person.snapshot.education[0].degree).toBe("BS");
        expect(person.snapshot.education[0].field).toBe("CS");
      });

      it("should extract .text from object-typed Degree and Field", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [
          {
            Name: "Stanford",
            Degree: { text: "Master of Science", textDirection: "ltr" },
            Field: { text: "Computer Science", textDirection: "ltr" },
          },
        ];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        expect(person.snapshot.education[0].school).toBe("Stanford");
        expect(person.snapshot.education[0].degree).toBe("Master of Science");
        expect(person.snapshot.education[0].field).toBe("Computer Science");
      });

      it("should String() coerce non-string non-object values", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [{ Name: 123, Degree: null, Field: undefined }];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        expect(person.snapshot.education[0].school).toBe("123");
        expect(person.snapshot.education[0].degree).toBeNull();
        expect(person.snapshot.education[0].field).toBeNull();
      });

      it("should handle null Name gracefully", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [{ Name: null, Degree: "BS", Field: "CS" }];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        expect(person.snapshot.education[0].school).toBeNull();
      });

      it("should deduplicate correctly after coercion", () => {
        const person = {
          _id: "test",
          snapshot: {
            education: [{ school: "MIT", degree: "BS", field: "CS" }],
          },
        };
        const schools = [
          {
            Name: { text: "MIT", textDirection: "ltr" },
            Degree: "BS",
            Field: "CS",
          },
        ];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(false);
        expect(person.snapshot.education).toHaveLength(1);
      });

      it("should coerce rich object From/To dates to strings before parsing", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [
          {
            Name: "MIT",
            Degree: "BS",
            Field: "CS",
            From: { text: "2018", textDirection: "ltr", attributesV2: [] },
            To: { text: "2022", textDirection: "ltr", attributesV2: [] },
          },
        ];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        const edu = person.snapshot.education[0];
        expect(edu.school).toBe("MIT");
        // Dates should be parsed from the extracted text, not null
        expect(edu.startDate).toBeInstanceOf(Date);
        expect(edu.endDate).toBeInstanceOf(Date);
        expect(edu.startDate.getUTCFullYear()).toBe(2018);
        expect(edu.endDate.getUTCFullYear()).toBe(2022);
      });

      it("should return null dates when From/To rich objects have no text", () => {
        const person = { _id: "test", snapshot: { education: [] } };
        const schools = [
          {
            Name: "Stanford",
            Degree: "PhD",
            Field: "Physics",
            From: { textDirection: "ltr", attributesV2: [] },
            To: null,
          },
        ];

        const updated = updateEducation(person, schools);

        expect(updated).toBe(true);
        const edu = person.snapshot.education[0];
        expect(edu.startDate).toBeNull();
        expect(edu.endDate).toBeNull();
      });
    });

    describe("coerceToString()", () => {
      it("should return null for null", () => {
        expect(coerceToString(null)).toBeNull();
      });

      it("should return null for undefined", () => {
        expect(coerceToString(undefined)).toBeNull();
      });

      it("should return string as-is", () => {
        expect(coerceToString("MIT")).toBe("MIT");
      });

      it("should extract .text from object", () => {
        expect(coerceToString({ text: "MIT", textDirection: "ltr" })).toBe(
          "MIT",
        );
      });

      it("should String() coerce numbers", () => {
        expect(coerceToString(123)).toBe("123");
      });

      it("should fall through to String() when .text is null", () => {
        // Object with null .text is not a DuxSoup rich object; String() coercion applies
        expect(typeof coerceToString({ text: null, other: "x" })).toBe(
          "string",
        );
      });
    });

    describe("updateSkills() caps", () => {
      it("should add skills when below cap", () => {
        const person = { _id: "test", snapshot: { skills: [] } };

        const updated = updateSkills(person, ["JavaScript", "Python"]);

        expect(updated).toBe(true);
        expect(person.snapshot.skills).toHaveLength(2);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("should drop skills and log warning once when at cap", () => {
        const person = {
          _id: "test",
          snapshot: {
            skills: Array.from({ length: 100 }, (_, i) => `Skill ${i}`),
          },
        };

        updateSkills(person, ["Overflow A", "Overflow B"]);

        expect(person.snapshot.skills).toHaveLength(100);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          "Skills array at capacity, dropping new skills",
          expect.objectContaining({ maxSkills: 100 }),
        );
      });

      it("should fill up to MAX_SKILLS and drop the rest", () => {
        const person = {
          _id: "test",
          snapshot: {
            skills: Array.from({ length: 98 }, (_, i) => `Skill ${i}`),
          },
        };

        updateSkills(person, ["New A", "New B", "New C", "New D"]);

        expect(person.snapshot.skills).toHaveLength(100);
        expect(person.snapshot.skills).toContain("New A");
        expect(person.snapshot.skills).toContain("New B");
        expect(person.snapshot.skills).not.toContain("New C");
        expect(logger.warn).toHaveBeenCalledTimes(1);
      });

      it("should not count duplicates toward the cap", () => {
        const person = {
          _id: "test",
          snapshot: { skills: ["JavaScript"] },
        };

        const updated = updateSkills(person, ["JavaScript"]);

        expect(updated).toBe(false);
        expect(person.snapshot.skills).toHaveLength(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it("should return false for empty or null skills", () => {
        const person = { _id: "test", snapshot: { skills: [] } };

        expect(updateSkills(person, null)).toBe(false);
        expect(updateSkills(person, [])).toBe(false);
      });
    });
  });

  // Note: Integration tests for upsertFromObservation() moved to separate file
  // See personController.integration.test.js for DB-backed tests
});
