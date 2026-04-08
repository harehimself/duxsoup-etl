const {
  WARNING_CODES,
  createCollector,
} = require("../src/utils/warningCollector");

describe("warningCollector", () => {
  describe("WARNING_CODES", () => {
    it("should export all expected warning codes", () => {
      const expectedCodes = [
        "SCHEMA_TYPE_VIOLATION",
        "SCHEMA_UNKNOWN_FIELD",
        "NO_STABLE_ID",
        "INVALID_EMAIL_FORMAT",
        "INVALID_CONNECTIONS",
        "INVALID_DEGREE",
        "INVERTED_DATE_RANGE",
        "ROLES_AT_CAPACITY",
        "EDUCATION_AT_CAPACITY",
        "SKILLS_AT_CAPACITY",
        "COMPANY_UPSERT_FAILED",
        "LOCATION_UPSERT_FAILED",
        "PERSON_UPSERT_FAILED",
        "DEBOUNCED",
      ];

      for (const code of expectedCodes) {
        expect(WARNING_CODES[code]).toBe(code);
      }
    });

    it("should have string values matching their keys", () => {
      for (const [key, value] of Object.entries(WARNING_CODES)) {
        expect(value).toBe(key);
      }
    });
  });

  describe("createCollector()", () => {
    it("should return a collector with expected methods", () => {
      const collector = createCollector();
      expect(typeof collector.add).toBe("function");
      expect(typeof collector.getAll).toBe("function");
      expect(typeof collector.hasWarnings).toBe("function");
      expect(collector.codes).toBe(WARNING_CODES);
    });

    it("should start with no warnings", () => {
      const collector = createCollector();
      expect(collector.getAll()).toEqual([]);
      expect(collector.hasWarnings()).toBe(false);
    });

    it("should accumulate warnings via add()", () => {
      const collector = createCollector();
      collector.add(
        "ROLES_AT_CAPACITY",
        "Role dropped: roles array at capacity",
      );
      collector.add("NO_STABLE_ID", "No stable ID found");

      expect(collector.hasWarnings()).toBe(true);
      expect(collector.getAll()).toHaveLength(2);
    });

    it("should include field and details when provided", () => {
      const collector = createCollector();
      collector.add("ROLES_AT_CAPACITY", "Role dropped", {
        field: "roles",
        details: { max: 50 },
      });

      const warnings = collector.getAll();
      expect(warnings[0]).toEqual({
        code: "ROLES_AT_CAPACITY",
        message: "Role dropped",
        field: "roles",
        details: { max: 50 },
      });
    });

    it("should omit field and details when not provided", () => {
      const collector = createCollector();
      collector.add("DEBOUNCED", "Entity upserts skipped");

      const warnings = collector.getAll();
      expect(warnings[0]).toEqual({
        code: "DEBOUNCED",
        message: "Entity upserts skipped",
      });
      expect(warnings[0]).not.toHaveProperty("field");
      expect(warnings[0]).not.toHaveProperty("details");
    });

    it("should include field only when provided without details", () => {
      const collector = createCollector();
      collector.add("INVALID_EMAIL_FORMAT", "Bad email", { field: "email" });

      const warnings = collector.getAll();
      expect(warnings[0]).toEqual({
        code: "INVALID_EMAIL_FORMAT",
        message: "Bad email",
        field: "email",
      });
      expect(warnings[0]).not.toHaveProperty("details");
    });

    it("should isolate collectors from each other", () => {
      const c1 = createCollector();
      const c2 = createCollector();

      c1.add("NO_STABLE_ID", "Missing ID");

      expect(c1.hasWarnings()).toBe(true);
      expect(c2.hasWarnings()).toBe(false);
      expect(c2.getAll()).toEqual([]);
    });

    it("should preserve insertion order", () => {
      const collector = createCollector();
      collector.add("NO_STABLE_ID", "First");
      collector.add("DEBOUNCED", "Second");
      collector.add("ROLES_AT_CAPACITY", "Third");

      const codes = collector.getAll().map((w) => w.code);
      expect(codes).toEqual(["NO_STABLE_ID", "DEBOUNCED", "ROLES_AT_CAPACITY"]);
    });
  });
});
