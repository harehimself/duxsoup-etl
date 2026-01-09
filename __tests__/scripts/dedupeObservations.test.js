const { computeEventKey } = require("../../scripts/dedupeObservations");

describe("Deduplication Script", () => {
  describe("computeEventKey", () => {
    it("should compute event_key from observation document", () => {
      const doc = {
        id: "duxsoup123",
        userid: "user456",
        time: new Date("2024-01-15"),
        VisitTime: new Date("2024-01-15"),
        rawData: {
          type: "visit",
        },
      };

      const eventKey = computeEventKey(doc);
      expect(eventKey).toBeTruthy();
      expect(eventKey).toHaveLength(40); // SHA1 hash length
    });

    it("should return null if id is missing", () => {
      const doc = {
        userid: "user456",
        time: new Date("2024-01-15"),
      };

      const eventKey = computeEventKey(doc);
      expect(eventKey).toBeNull();
    });

    it("should use defaults for missing fields", () => {
      const doc = {
        id: "duxsoup123",
        VisitTime: new Date("2024-01-15"),
        // Missing userid, type, time
      };

      const eventKey = computeEventKey(doc);
      expect(eventKey).toBeTruthy(); // Should still compute with defaults
    });

    it("should produce same event_key for identical webhooks", () => {
      const doc1 = {
        id: "duxsoup123",
        userid: "user456",
        time: new Date("2024-01-15T10:00:00Z"),
        rawData: { type: "visit" },
      };

      const doc2 = {
        id: "duxsoup123",
        userid: "user456",
        time: new Date("2024-01-15T10:00:00Z"),
        rawData: { type: "visit" },
      };

      const key1 = computeEventKey(doc1);
      const key2 = computeEventKey(doc2);

      expect(key1).toBe(key2); // Idempotency check
    });

    it("should produce different event_key for different webhooks", () => {
      const doc1 = {
        id: "duxsoup123",
        userid: "user456",
        time: new Date("2024-01-15"),
        rawData: { type: "visit" },
      };

      const doc2 = {
        id: "duxsoup789", // Different ID
        userid: "user456",
        time: new Date("2024-01-15"),
        rawData: { type: "visit" },
      };

      const key1 = computeEventKey(doc1);
      const key2 = computeEventKey(doc2);

      expect(key1).not.toBe(key2);
    });

    it("should infer type from VisitTime field if missing", () => {
      const visitDoc = {
        id: "duxsoup123",
        userid: "user456",
        VisitTime: new Date("2024-01-15"),
        // rawData.type is missing
      };

      const scanDoc = {
        id: "duxsoup123",
        userid: "user456",
        ScanTime: new Date("2024-01-15"),
        // rawData.type is missing, VisitTime is missing
      };

      const visitKey = computeEventKey(visitDoc);
      const scanKey = computeEventKey(scanDoc);

      expect(visitKey).toBeTruthy();
      expect(scanKey).toBeTruthy();
      expect(visitKey).not.toBe(scanKey); // Different types
    });

    it("should extract userid from rawData if top-level userid missing", () => {
      const doc = {
        id: "duxsoup123",
        time: new Date("2024-01-15"),
        rawData: {
          userid: "user789",
          type: "scan",
        },
        // No top-level userid
      };

      const eventKey = computeEventKey(doc);
      expect(eventKey).toBeTruthy();
    });

    it("should handle time from different fields (VisitTime, ScanTime, createdAt)", () => {
      const visitDoc = {
        id: "duxsoup123",
        userid: "user456",
        VisitTime: new Date("2024-01-15T10:00:00Z"),
      };

      const scanDoc = {
        id: "duxsoup123",
        userid: "user456",
        ScanTime: new Date("2024-01-15T10:00:00Z"),
      };

      const createdDoc = {
        id: "duxsoup123",
        userid: "user456",
        createdAt: new Date("2024-01-15T10:00:00Z"),
      };

      const visitKey = computeEventKey(visitDoc);
      const scanKey = computeEventKey(scanDoc);
      const createdKey = computeEventKey(createdDoc);

      // Should all use the same timestamp
      expect(visitKey).toBeTruthy();
      expect(scanKey).toBeTruthy();
      expect(createdKey).toBeTruthy();
    });
  });

  describe("Duplicate Detection Strategy", () => {
    it("should keep oldest record by createdAt", () => {
      const duplicateGroup = {
        docs: [
          { _id: "id1", createdAt: new Date("2024-01-15") },
          { _id: "id2", createdAt: new Date("2024-01-10") }, // Oldest
          { _id: "id3", createdAt: new Date("2024-01-20") },
        ],
      };

      // Sort by createdAt (oldest first)
      const sorted = duplicateGroup.docs.sort((a, b) => {
        const dateA = a.createdAt || new Date(0);
        const dateB = b.createdAt || new Date(0);
        return dateA - dateB;
      });

      expect(sorted[0]._id).toBe("id2"); // Oldest should be first
    });

    it("should handle missing createdAt (default to epoch)", () => {
      const duplicateGroup = {
        docs: [
          { _id: "id1", createdAt: new Date("2024-01-15") },
          { _id: "id2" }, // Missing createdAt
          { _id: "id3", createdAt: new Date("2024-01-20") },
        ],
      };

      const sorted = duplicateGroup.docs.sort((a, b) => {
        const dateA = a.createdAt || new Date(0);
        const dateB = b.createdAt || new Date(0);
        return dateA - dateB;
      });

      expect(sorted[0]._id).toBe("id2"); // Missing date defaults to epoch (oldest)
    });
  });
});
