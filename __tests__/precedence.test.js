const {
  shouldOverwrite,
  SOURCE_PRECEDENCE,
} = require("../src/utils/precedence");

describe("precedence utility", () => {
  describe("SOURCE_PRECEDENCE", () => {
    it("should export correct precedence values", () => {
      expect(SOURCE_PRECEDENCE).toEqual({ visit: 2, scan: 1 });
    });
  });

  describe("shouldOverwrite()", () => {
    it("should accept when no existing meta (null)", () => {
      const result = shouldOverwrite(null, {
        value: "John Doe",
        observedAt: new Date("2024-01-15"),
        source: "visit",
      });
      expect(result).toBe(true);
    });

    it("should accept when existing value is null", () => {
      const result = shouldOverwrite(
        { value: null, observedAt: new Date("2024-01-01"), source: "visit" },
        { value: "Jane", observedAt: new Date("2024-01-15"), source: "scan" },
      );
      expect(result).toBe(true);
    });

    it("should accept when existing value is undefined", () => {
      const result = shouldOverwrite(
        {
          value: undefined,
          observedAt: new Date("2024-01-01"),
          source: "visit",
        },
        { value: "Jane", observedAt: new Date("2024-01-15"), source: "scan" },
      );
      expect(result).toBe(true);
    });

    // --- Reject empty/blank incoming ---

    it("should reject null incoming value", () => {
      const result = shouldOverwrite(
        { value: 500, observedAt: new Date("2024-01-01"), source: "visit" },
        { value: null, observedAt: new Date("2024-01-15"), source: "visit" },
      );
      expect(result).toBe(false);
    });

    it("should reject undefined incoming value", () => {
      const result = shouldOverwrite(
        {
          value: "John Doe",
          observedAt: new Date("2024-01-01"),
          source: "visit",
        },
        {
          value: undefined,
          observedAt: new Date("2024-01-15"),
          source: "visit",
        },
      );
      expect(result).toBe(false);
    });

    it("should reject empty string incoming value", () => {
      const result = shouldOverwrite(
        {
          value: "John Doe",
          observedAt: new Date("2024-01-01"),
          source: "scan",
        },
        { value: "", observedAt: new Date("2024-01-15"), source: "visit" },
      );
      expect(result).toBe(false);
    });

    it("should reject whitespace-only string incoming value", () => {
      const result = shouldOverwrite(
        {
          value: "John Doe",
          observedAt: new Date("2024-01-01"),
          source: "visit",
        },
        { value: "   ", observedAt: new Date("2024-01-15"), source: "visit" },
      );
      expect(result).toBe(false);
    });

    it("should reject NaN incoming value", () => {
      const result = shouldOverwrite(
        { value: 500, observedAt: new Date("2024-01-01"), source: "visit" },
        { value: NaN, observedAt: new Date("2024-01-15"), source: "visit" },
      );
      expect(result).toBe(false);
    });

    it("should accept numeric 0 incoming value (falsy but valid)", () => {
      const result = shouldOverwrite(null, {
        value: 0,
        observedAt: new Date("2024-01-15"),
        source: "visit",
      });
      expect(result).toBe(true);
    });

    // --- Source precedence ---

    it("should allow visit to override scan (higher source precedence)", () => {
      const result = shouldOverwrite(
        {
          value: "San Francisco",
          observedAt: new Date("2024-01-15"),
          source: "scan",
        },
        {
          value: "New York",
          observedAt: new Date("2024-01-10"),
          source: "visit",
        },
      );
      expect(result).toBe(true);
    });

    it("should reject scan when visit exists (lower source precedence)", () => {
      const result = shouldOverwrite(
        {
          value: "New York",
          observedAt: new Date("2024-01-10"),
          source: "visit",
        },
        {
          value: "San Francisco",
          observedAt: new Date("2024-01-15"),
          source: "scan",
        },
      );
      expect(result).toBe(false);
    });

    it("should treat unknown source as precedence 0", () => {
      // unknown vs scan: scan (1) > unknown (0) → should overwrite
      const result = shouldOverwrite(
        {
          value: "Old",
          observedAt: new Date("2024-01-01"),
          source: "unknown",
        },
        { value: "New", observedAt: new Date("2024-01-15"), source: "scan" },
      );
      expect(result).toBe(true);
    });

    // --- Same precedence: newer wins ---

    it("should allow newer visit to override older visit", () => {
      const result = shouldOverwrite(
        {
          value: "Engineer",
          observedAt: new Date("2024-01-01"),
          source: "visit",
        },
        {
          value: "Senior Engineer",
          observedAt: new Date("2024-01-15"),
          source: "visit",
        },
      );
      expect(result).toBe(true);
    });

    it("should reject older visit when newer exists", () => {
      const result = shouldOverwrite(
        {
          value: "Senior Engineer",
          observedAt: new Date("2024-01-15"),
          source: "visit",
        },
        {
          value: "Engineer",
          observedAt: new Date("2024-01-01"),
          source: "visit",
        },
      );
      expect(result).toBe(false);
    });

    it("should accept when same timestamp (>= semantics)", () => {
      const ts = new Date("2024-01-15");
      const result = shouldOverwrite(
        { value: "Old", observedAt: ts, source: "visit" },
        { value: "New", observedAt: ts, source: "visit" },
      );
      expect(result).toBe(true);
    });

    // --- Edge cases with existing zero ---

    it("should not treat existing 0 as empty", () => {
      const result = shouldOverwrite(
        { value: 0, observedAt: new Date("2024-01-01"), source: "visit" },
        { value: 500, observedAt: new Date("2024-01-15"), source: "scan" },
      );
      expect(result).toBe(false); // scan cannot overwrite visit
    });

    it("should allow overwriting existing 0 with same-source newer value", () => {
      const result = shouldOverwrite(
        { value: 0, observedAt: new Date("2024-01-01"), source: "visit" },
        { value: 100, observedAt: new Date("2024-01-15"), source: "visit" },
      );
      expect(result).toBe(true);
    });

    // --- Number values ---

    it("should accept incoming number value", () => {
      const result = shouldOverwrite(null, {
        value: 500,
        observedAt: new Date("2024-01-15"),
        source: "visit",
      });
      expect(result).toBe(true);
    });

    it("should overwrite existing number with higher-precedence source", () => {
      const result = shouldOverwrite(
        { value: 250, observedAt: new Date("2024-01-01"), source: "scan" },
        { value: 500, observedAt: new Date("2024-01-10"), source: "visit" },
      );
      expect(result).toBe(true);
    });
  });
});
