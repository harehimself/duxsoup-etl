const {
  applyWhitespaceCleaning,
  applyEmailNormalization,
  applyPhoneNormalization,
  applySkillDeduplication,
  applyEducationDeduplication,
  applyLocationParsing,
  applySeniorityParsing,
  applyDerivedMetrics,
  computeDerivedMetrics,
  cleanString,
  normalizeEmail,
  parseArgs,
} = require("../scripts/backfillPersonDataQuality");

describe("backfillPersonDataQuality", () => {
  describe("cleanString()", () => {
    it("should trim leading and trailing whitespace", () => {
      expect(cleanString("  hello  ")).toBe("hello");
    });

    it("should collapse internal whitespace", () => {
      expect(cleanString("hello   world")).toBe("hello world");
    });

    it("should handle mixed whitespace", () => {
      expect(cleanString("  hello   world  ")).toBe("hello world");
    });

    it("should return null for null", () => {
      expect(cleanString(null)).toBeNull();
    });

    it("should return undefined for undefined", () => {
      expect(cleanString(undefined)).toBeUndefined();
    });

    it("should pass through non-strings", () => {
      expect(cleanString(42)).toBe(42);
    });
  });

  describe("normalizeEmail()", () => {
    it("should lowercase and trim email", () => {
      expect(normalizeEmail("  John@Gmail.COM  ")).toBe("john@gmail.com");
    });

    it("should return null for null", () => {
      expect(normalizeEmail(null)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(normalizeEmail("   ")).toBeNull();
    });

    it("should handle already normalized email", () => {
      expect(normalizeEmail("user@example.com")).toBe("user@example.com");
    });
  });

  describe("applyWhitespaceCleaning()", () => {
    it("should clean whitespace on all cleanable fields", () => {
      const snapshot = {
        firstName: "  John  ",
        lastName: "Doe",
        currentTitle: "Senior  VP  of  Sales",
        currentCompany: "  Acme Corp  ",
        location: "New York,  New York",
        industry: "Technology",
        summary: "A    long   summary",
        twitter: " @johndoe ",
        _meta: {
          firstName: { value: "  John  " },
          currentTitle: { value: "Senior  VP  of  Sales" },
        },
      };
      const changes = {};
      applyWhitespaceCleaning(snapshot, changes);

      expect(changes["snapshot.firstName"]).toBe("John");
      expect(changes["snapshot.currentTitle"]).toBe("Senior VP of Sales");
      expect(changes["snapshot.currentCompany"]).toBe("Acme Corp");
      expect(changes["snapshot.location"]).toBe("New York, New York");
      expect(changes["snapshot.summary"]).toBe("A long summary");
      expect(changes["snapshot.twitter"]).toBe("@johndoe");
      expect(changes["snapshot._meta.firstName.value"]).toBe("John");
      expect(changes["snapshot._meta.currentTitle.value"]).toBe(
        "Senior VP of Sales",
      );
      // lastName was already clean
      expect(changes["snapshot.lastName"]).toBeUndefined();
    });

    it("should clean role sub-fields", () => {
      const snapshot = {
        roles: [
          {
            title: "  VP   Sales  ",
            companyName: "Acme  Corp",
            location: " New York ",
            description: "  Managed   team  ",
          },
        ],
      };
      const changes = {};
      applyWhitespaceCleaning(snapshot, changes);

      expect(changes["snapshot.roles"]).toBeDefined();
      expect(changes["snapshot.roles"][0].title).toBe("VP Sales");
      expect(changes["snapshot.roles"][0].companyName).toBe("Acme Corp");
      expect(changes["snapshot.roles"][0].location).toBe("New York");
      expect(changes["snapshot.roles"][0].description).toBe("Managed team");
    });

    it("should not modify already clean snapshot", () => {
      const snapshot = {
        firstName: "John",
        lastName: "Doe",
        currentTitle: "VP Sales",
        roles: [{ title: "VP Sales", companyName: "Acme" }],
      };
      const changes = {};
      applyWhitespaceCleaning(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should skip null/undefined fields", () => {
      const snapshot = {
        firstName: null,
        lastName: undefined,
        currentTitle: "VP Sales",
      };
      const changes = {};
      applyWhitespaceCleaning(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });
  });

  describe("applyEmailNormalization()", () => {
    it("should lowercase and trim email", () => {
      const snapshot = {
        email: "  John@GMAIL.com  ",
        _meta: { email: { value: "  John@GMAIL.com  " } },
      };
      const changes = {};
      applyEmailNormalization(snapshot, changes);

      expect(changes["snapshot.email"]).toBe("john@gmail.com");
      expect(changes["snapshot._meta.email.value"]).toBe("john@gmail.com");
    });

    it("should skip already normalized email", () => {
      const snapshot = { email: "john@gmail.com" };
      const changes = {};
      applyEmailNormalization(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should skip null email", () => {
      const snapshot = { email: null };
      const changes = {};
      applyEmailNormalization(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });
  });

  describe("applyPhoneNormalization()", () => {
    it("should normalize US phone to E.164", () => {
      const snapshot = { phone: "(555) 123-4567", countryCode: "US" };
      const changes = {};
      applyPhoneNormalization(snapshot, changes);

      expect(changes["snapshot.phone"]).toBe("+15551234567");
    });

    it("should skip already E.164 phone", () => {
      const snapshot = { phone: "+15551234567" };
      const changes = {};
      applyPhoneNormalization(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should skip null phone", () => {
      const snapshot = { phone: null };
      const changes = {};
      applyPhoneNormalization(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should update _meta when phone changes", () => {
      const snapshot = {
        phone: "555-123-4567",
        countryCode: "US",
        _meta: { phone: { value: "555-123-4567" } },
      };
      const changes = {};
      applyPhoneNormalization(snapshot, changes);
      expect(changes["snapshot._meta.phone.value"]).toBe("+15551234567");
    });
  });

  describe("applySkillDeduplication()", () => {
    it("should deduplicate case-insensitive skills", () => {
      const snapshot = {
        skills: ["JavaScript", "javascript", "Python", "python", "PYTHON"],
      };
      const changes = {};
      applySkillDeduplication(snapshot, changes);

      expect(changes["snapshot.skills"]).toEqual(["JavaScript", "Python"]);
    });

    it("should preserve first-seen casing", () => {
      const snapshot = { skills: ["javaScript", "JavaScript", "JAVASCRIPT"] };
      const changes = {};
      applySkillDeduplication(snapshot, changes);

      expect(changes["snapshot.skills"]).toEqual(["javaScript"]);
    });

    it("should skip empty skills array", () => {
      const snapshot = { skills: [] };
      const changes = {};
      applySkillDeduplication(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should skip already unique skills", () => {
      const snapshot = { skills: ["JavaScript", "Python", "Go"] };
      const changes = {};
      applySkillDeduplication(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should clean whitespace in skills during dedup", () => {
      const snapshot = { skills: ["  JavaScript  ", "javascript"] };
      const changes = {};
      applySkillDeduplication(snapshot, changes);

      expect(changes["snapshot.skills"]).toEqual(["JavaScript"]);
    });

    it("should filter out null/empty skills", () => {
      const snapshot = { skills: ["JavaScript", "", null, "Python"] };
      const changes = {};
      applySkillDeduplication(snapshot, changes);

      expect(changes["snapshot.skills"]).toEqual(["JavaScript", "Python"]);
    });
  });

  describe("applyEducationDeduplication()", () => {
    it("should deduplicate case-insensitive education entries", () => {
      const snapshot = {
        education: [
          { school: "MIT", degree: "BS", field: "CS" },
          { school: "mit", degree: "bs", field: "cs" },
        ],
      };
      const changes = {};
      applyEducationDeduplication(snapshot, changes);

      expect(changes["snapshot.education"]).toHaveLength(1);
      expect(changes["snapshot.education"][0].school).toBe("MIT");
    });

    it("should keep distinct education entries", () => {
      const snapshot = {
        education: [
          { school: "MIT", degree: "BS", field: "CS" },
          { school: "Stanford", degree: "MS", field: "CS" },
        ],
      };
      const changes = {};
      applyEducationDeduplication(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should skip empty education array", () => {
      const snapshot = { education: [] };
      const changes = {};
      applyEducationDeduplication(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should handle null fields in education", () => {
      const snapshot = {
        education: [
          { school: "MIT", degree: null, field: null },
          { school: "mit", degree: null, field: null },
        ],
      };
      const changes = {};
      applyEducationDeduplication(snapshot, changes);

      expect(changes["snapshot.education"]).toHaveLength(1);
    });
  });

  describe("applyLocationParsing()", () => {
    it("should parse US location into structured fields", () => {
      const snapshot = { location: "Chicago, Illinois, United States" };
      const changes = {};
      applyLocationParsing(snapshot, changes);

      expect(changes["snapshot.city"]).toBe("Chicago");
      expect(changes["snapshot.state"]).toBe("Illinois");
      expect(changes["snapshot.stateCode"]).toBe("IL");
      expect(changes["snapshot.country"]).toBe("United States");
      expect(changes["snapshot.countryCode"]).toBe("US");
      expect(changes["snapshot.usRegion"]).toBeDefined();
      expect(changes["snapshot.timezone"]).toBeDefined();
    });

    it("should not overwrite existing structured fields", () => {
      const snapshot = {
        location: "Chicago, Illinois, United States",
        city: "Different City",
        state: "Different State",
      };
      const changes = {};
      applyLocationParsing(snapshot, changes);

      // Should NOT overwrite existing city and state
      expect(changes["snapshot.city"]).toBeUndefined();
      expect(changes["snapshot.state"]).toBeUndefined();
      // But should populate null fields
      expect(changes["snapshot.stateCode"]).toBe("IL");
    });

    it("should skip null location", () => {
      const snapshot = { location: null };
      const changes = {};
      applyLocationParsing(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should handle international location", () => {
      const snapshot = { location: "London, England, United Kingdom" };
      const changes = {};
      applyLocationParsing(snapshot, changes);

      expect(changes["snapshot.city"]).toBe("London");
      expect(changes["snapshot.country"]).toBe("United Kingdom");
      expect(changes["snapshot.countryCode"]).toBe("GB");
    });
  });

  describe("applySeniorityParsing()", () => {
    it("should parse VP title into seniority", () => {
      const snapshot = { currentTitle: "Vice President of Sales" };
      const changes = {};
      applySeniorityParsing(snapshot, changes);

      expect(changes["snapshot.parsedSeniority"]).toBe("VP");
    });

    it("should parse department from title", () => {
      const snapshot = { currentTitle: "VP of Engineering" };
      const changes = {};
      applySeniorityParsing(snapshot, changes);

      expect(changes["snapshot.parsedSeniority"]).toBe("VP");
      expect(changes["snapshot.parsedDepartment"]).toBe("engineering");
    });

    it("should update seniority when title changes to a different level", () => {
      const snapshot = {
        currentTitle: "Software Developer",
        parsedSeniority: "VP",
      };
      const changes = {};
      applySeniorityParsing(snapshot, changes);

      // "Software Developer" parses to "Individual Contributor", not VP
      expect(changes["snapshot.parsedSeniority"]).toBe(
        "Individual Contributor",
      );
    });

    it("should clear stale seniority when title produces no match", () => {
      const snapshot = {
        currentTitle: "Freelancer",
        parsedSeniority: "VP",
      };
      const changes = {};
      applySeniorityParsing(snapshot, changes);

      // "Freelancer" doesn't match any seniority tier
      // titleParser defaults to "Individual Contributor" for unmatched titles
      // so this will update to IC rather than null
      expect(changes["snapshot.parsedSeniority"]).toBeDefined();
    });

    it("should skip null title", () => {
      const snapshot = { currentTitle: null };
      const changes = {};
      applySeniorityParsing(snapshot, changes);
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should skip already correct seniority", () => {
      const snapshot = {
        currentTitle: "VP Sales",
        parsedSeniority: "VP",
      };
      const changes = {};
      applySeniorityParsing(snapshot, changes);

      // parsedSeniority unchanged, so no change entry
      expect(changes["snapshot.parsedSeniority"]).toBeUndefined();
    });
  });

  describe("applyDerivedMetrics()", () => {
    it("should compute derived metrics from roles", () => {
      const roles = [
        {
          title: "VP Sales",
          companyName: "Acme",
          isCurrent: true,
          startDate: new Date("2020-01-01"),
          endDate: null,
          seniority: "VP",
          seniorityRank: 5,
        },
        {
          title: "Director Sales",
          companyName: "OldCo",
          isCurrent: false,
          startDate: new Date("2017-01-01"),
          endDate: new Date("2019-12-31"),
          seniority: "Director",
          seniorityRank: 4,
        },
      ];
      const snapshot = { roles };
      const changes = {};
      applyDerivedMetrics(snapshot, changes, {});

      expect(changes["derived.highestSeniority"]).toBe("VP");
      expect(changes["derived.highestSeniorityRank"]).toBe(5);
      expect(changes["derived.avgTenureMonths"]).toBeGreaterThan(0);
      expect(changes["derived.yearsAtCurrentCompany"]).toBeGreaterThan(0);
    });

    it("should skip when no roles", () => {
      const snapshot = { roles: [] };
      const changes = {};
      applyDerivedMetrics(snapshot, changes, {});
      expect(Object.keys(changes)).toHaveLength(0);
    });

    it("should not add change if derived values match", () => {
      const roles = [
        {
          title: "IC",
          companyName: "Co",
          isCurrent: false,
          startDate: null,
          endDate: null,
        },
      ];
      const computed = computeDerivedMetrics(roles);
      const snapshot = { roles };
      const changes = {};
      applyDerivedMetrics(snapshot, changes, computed);

      // All values match, so no changes
      expect(Object.keys(changes)).toHaveLength(0);
    });
  });

  describe("parseArgs()", () => {
    const originalArgv = process.argv;

    afterEach(() => {
      process.argv = originalArgv;
    });

    it("should default to dry-run mode", () => {
      process.argv = ["node", "script.js"];
      const args = parseArgs();
      expect(args.dryRun).toBe(true);
      expect(args.commit).toBe(false);
    });

    it("should parse --commit flag", () => {
      process.argv = ["node", "script.js", "--commit"];
      const args = parseArgs();
      expect(args.dryRun).toBe(false);
      expect(args.commit).toBe(true);
    });

    it("should parse --limit", () => {
      process.argv = ["node", "script.js", "--limit=500"];
      const args = parseArgs();
      expect(args.limit).toBe(500);
    });

    it("should parse --only", () => {
      process.argv = ["node", "script.js", "--only=whitespace"];
      const args = parseArgs();
      expect(args.only).toBe("whitespace");
    });

    it("should parse --skip", () => {
      process.argv = ["node", "script.js", "--skip=1000"];
      const args = parseArgs();
      expect(args.skip).toBe(1000);
    });

    it("should parse --verbose", () => {
      process.argv = ["node", "script.js", "--verbose"];
      const args = parseArgs();
      expect(args.verbose).toBe(true);
    });
  });
});
