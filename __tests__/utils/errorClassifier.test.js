const {
  classifyError,
  isPermanentError,
  PERMANENT_ERROR_PATTERNS,
} = require("../../src/utils/errorClassifier");

describe("errorClassifier", () => {
  describe("PERMANENT_ERROR_PATTERNS", () => {
    it("should export 7 patterns", () => {
      expect(PERMANENT_ERROR_PATTERNS).toHaveLength(7);
    });
  });

  describe("classifyError()", () => {
    it("should classify Cast to string errors as permanent", () => {
      expect(
        classifyError("Cast to string failed for value \"{ text: 'MBA' }\""),
      ).toBe("permanent");
    });

    it("should classify ValidationError as permanent", () => {
      expect(
        classifyError(
          "Person validation failed: snapshot.education.0.school: ValidationError",
        ),
      ).toBe("permanent");
    });

    it("should classify CastError as permanent", () => {
      expect(
        classifyError('CastError: Cast to ObjectId failed for value "bad-id"'),
      ).toBe("permanent");
    });

    it("should classify Cast to ObjectId (array) as permanent", () => {
      expect(classifyError('Cast to [ObjectId] failed for value "bad"')).toBe(
        "permanent",
      );
    });

    it("should classify invalid _id as permanent", () => {
      expect(classifyError("invalid _id format: flávia-silva/en")).toBe(
        "permanent",
      );
    });

    it("should classify Document failed validation as permanent", () => {
      expect(
        classifyError("Document failed validation on field snapshot.education"),
      ).toBe("permanent");
    });

    it("should classify E11000 duplicate key as permanent", () => {
      expect(
        classifyError(
          "E11000 duplicate key error collection: people index: _id_",
        ),
      ).toBe("permanent");
    });

    it("should classify timeout errors as transient", () => {
      expect(classifyError("MongoServerError: connection timed out")).toBe(
        "transient",
      );
    });

    it("should classify connection errors as transient", () => {
      expect(classifyError("MongoNetworkError: connect ECONNREFUSED")).toBe(
        "transient",
      );
    });

    it("should classify generic errors as transient", () => {
      expect(classifyError("Something unexpected happened")).toBe("transient");
    });

    it("should classify null as transient", () => {
      expect(classifyError(null)).toBe("transient");
    });

    it("should classify undefined as transient", () => {
      expect(classifyError(undefined)).toBe("transient");
    });

    it("should classify empty string as transient", () => {
      expect(classifyError("")).toBe("transient");
    });
  });

  describe("isPermanentError()", () => {
    it("should return true for permanent errors", () => {
      expect(isPermanentError("CastError: bad value")).toBe(true);
      expect(isPermanentError("E11000 duplicate key error")).toBe(true);
    });

    it("should return false for transient errors", () => {
      expect(isPermanentError("MongoNetworkError: connect ECONNREFUSED")).toBe(
        false,
      );
    });

    it("should return false for null/undefined/empty", () => {
      expect(isPermanentError(null)).toBe(false);
      expect(isPermanentError(undefined)).toBe(false);
      expect(isPermanentError("")).toBe(false);
    });
  });
});
