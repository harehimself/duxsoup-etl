const mongoose = require("mongoose");
const {
  computeEventKey,
  analyzeCollection,
  backfillEventKeys,
  identifyDuplicates,
  removeDuplicates,
} = require("../../scripts/dedupeObservations");

const Visit = require("../../src/models/visit");
const Scan = require("../../src/models/scan");

describe("Deduplication Script - Integration Tests", () => {
  let connection;

  // Helper function to create minimal valid visit data
  const createVisitData = (overrides = {}) => ({
    id: "dux1",
    userid: "user1",
    time: new Date("2024-01-15"),
    VisitTime: new Date("2024-01-15"),
    "First Name": "John",
    Degree: "1st",
    rawData: { type: "visit" },
    ...overrides,
  });

  // Helper function to create minimal valid scan data
  const createScanData = (overrides = {}) => ({
    id: "scan1",
    userid: "user1",
    time: new Date("2024-01-15"),
    ScanTime: new Date("2024-01-15"),
    "First Name": "John",
    "Last Name": "Doe",
    rawData: { type: "scan" },
    ...overrides,
  });

  beforeAll(async () => {
    // Connect to test database
    const uri =
      process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/duxsoup-test";
    connection = await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  describe("Full Deduplication Workflow - Visits", () => {
    beforeEach(async () => {
      // Clear collections before each test
      await Visit.deleteMany({});
      await mongoose.connection.db
        .collection("visits_duplicates_backup")
        .deleteMany({});

      // Drop the unique index on event_key to allow creating duplicates for testing
      try {
        await mongoose.connection.db
          .collection("visits")
          .dropIndex("event_key_1");
      } catch (err) {
        // Index might not exist, ignore error
      }
    });

    afterEach(async () => {
      // Recreate the unique sparse index after each test
      try {
        await mongoose.connection.db
          .collection("visits")
          .createIndex({ event_key: 1 }, { unique: true, sparse: true });
      } catch (err) {
        // Index might already exist, ignore error
      }
    });

    it("should analyze collection and report counts correctly", async () => {
      // Create test data: 3 with event_key, 2 without
      await Visit.create([
        {
          id: "dux1",
          userid: "user1",
          time: new Date("2024-01-15"),
          VisitTime: new Date("2024-01-15"),
          "First Name": "John",
          Degree: "1st",
          event_key: "existing_key_1",
          rawData: { type: "visit" },
        },
        {
          id: "dux2",
          userid: "user1",
          time: new Date("2024-01-16"),
          VisitTime: new Date("2024-01-16"),
          "First Name": "Jane",
          Degree: "2nd",
          event_key: "existing_key_2",
          rawData: { type: "visit" },
        },
        {
          id: "dux3",
          userid: "user1",
          time: new Date("2024-01-17"),
          VisitTime: new Date("2024-01-17"),
          "First Name": "Bob",
          Degree: "1st",
          event_key: "existing_key_3",
          rawData: { type: "visit" },
        },
        {
          id: "dux4",
          userid: "user1",
          time: new Date("2024-01-18"),
          VisitTime: new Date("2024-01-18"),
          "First Name": "Alice",
          Degree: "3rd",
          // No event_key (legacy)
          rawData: { type: "visit" },
        },
        {
          id: "dux5",
          userid: "user1",
          time: new Date("2024-01-19"),
          VisitTime: new Date("2024-01-19"),
          "First Name": "Charlie",
          Degree: "2nd",
          // No event_key (legacy)
          rawData: { type: "visit" },
        },
      ]);

      const analysis = await analyzeCollection(Visit, "visits");

      expect(analysis.total).toBe(5);
      expect(analysis.withEventKey).toBe(3);
      expect(analysis.withoutEventKey).toBe(2);
      expect(analysis.duplicateEventKeys).toBe(0);
    });

    it("should backfill event_keys for legacy records", async () => {
      // Create legacy records without event_key
      await Visit.create([
        createVisitData({
          id: "dux1",
          time: new Date("2024-01-15"),
          VisitTime: new Date("2024-01-15"),
        }),
        createVisitData({
          id: "dux2",
          time: new Date("2024-01-16"),
          VisitTime: new Date("2024-01-16"),
        }),
      ]);

      // Backfill in execute mode (dryRun = false)
      const results = await backfillEventKeys(Visit, "visits", false);

      expect(results.backfilled).toBe(2);
      expect(results.skipped).toBe(0);

      // Verify event_keys were added
      const visits = await Visit.find({}).lean();
      expect(visits[0].event_key).toBeTruthy();
      expect(visits[0].event_key).toHaveLength(40); // SHA1 hash
      expect(visits[1].event_key).toBeTruthy();
      expect(visits[1].event_key).toHaveLength(40);
    });

    it("should skip backfill for records missing required fields", async () => {
      // Create record without 'id' field (required for event_key)
      // Use insertOne to bypass Mongoose validation
      await mongoose.connection.db.collection("visits").insertOne({
        userid: "user1",
        time: new Date("2024-01-15"),
        VisitTime: new Date("2024-01-15"),
        "First Name": "John",
        Degree: "1st",
        rawData: { type: "visit" },
        // No 'id' field - this is what we're testing
      });

      const results = await backfillEventKeys(Visit, "visits", false);

      expect(results.backfilled).toBe(0);
      expect(results.skipped).toBe(1);

      // Verify event_key was NOT added
      const visit = await mongoose.connection.db
        .collection("visits")
        .findOne({});
      expect(visit.event_key).toBeUndefined();
    });

    it("should detect duplicate event_keys during backfill", async () => {
      // Create two records that will have the same event_key
      const baseData = createVisitData({
        id: "dux1",
        userid: "user1",
        time: new Date("2024-01-15T10:00:00Z"),
        VisitTime: new Date("2024-01-15T10:00:00Z"),
      });

      await Visit.create([
        {
          ...baseData,
          createdAt: new Date("2024-01-10"), // Older
        },
        {
          ...baseData,
          createdAt: new Date("2024-01-20"), // Newer
        },
      ]);

      const results = await backfillEventKeys(Visit, "visits", false);

      // First should succeed, second should be skipped as duplicate
      expect(results.backfilled).toBe(1);
      expect(results.skipped).toBe(1);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0]).toMatchObject({
        event_key: expect.any(String),
      });
    });

    it("should identify duplicate groups correctly", async () => {
      const eventKey = "duplicate_event_key_123";

      // Create 3 records with the same event_key
      // Use insertMany to bypass unique index constraint
      await mongoose.connection.db.collection("visits").insertMany([
        {
          ...createVisitData({
            id: "dux1",
            time: new Date("2024-01-15"),
            VisitTime: new Date("2024-01-15"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-10"),
        },
        {
          ...createVisitData({
            id: "dux2",
            time: new Date("2024-01-16"),
            VisitTime: new Date("2024-01-16"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-15"),
        },
        {
          ...createVisitData({
            id: "dux3",
            time: new Date("2024-01-17"),
            VisitTime: new Date("2024-01-17"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-20"),
        },
      ]);

      const { groups, totalDuplicates } = await identifyDuplicates(
        Visit,
        "visits",
      );

      expect(groups).toHaveLength(1);
      expect(groups[0]._id).toBe(eventKey);
      expect(groups[0].count).toBe(3);
      expect(totalDuplicates).toBe(2); // 3 records - 1 to keep = 2 to remove
    });

    it("should remove duplicates and keep oldest record", async () => {
      const eventKey = "duplicate_event_key_456";

      // Create duplicates with different createdAt timestamps
      // Use insertMany to bypass unique index constraint
      const result = await mongoose.connection.db.collection("visits").insertMany([
        {
          ...createVisitData({
            id: "dux1",
            time: new Date("2024-01-15"),
            VisitTime: new Date("2024-01-15"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-10"), // OLDEST - should be kept
        },
        {
          ...createVisitData({
            id: "dux2",
            time: new Date("2024-01-16"),
            VisitTime: new Date("2024-01-16"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-15"), // Should be removed
        },
        {
          ...createVisitData({
            id: "dux3",
            time: new Date("2024-01-17"),
            VisitTime: new Date("2024-01-17"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-20"), // NEWEST - should be removed
        },
      ]);

      const doc1 = { _id: result.insertedIds[0] };
      const doc2 = { _id: result.insertedIds[1] };
      const doc3 = { _id: result.insertedIds[2] };

      // Identify duplicates first
      const { groups } = await identifyDuplicates(Visit, "visits");

      // Remove duplicates (execute mode)
      const results = await removeDuplicates(Visit, "visits", groups, false);

      expect(results.kept).toBe(1);
      expect(results.removed).toBe(2);

      // Verify only oldest record remains
      const remaining = await Visit.find({}).lean();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]._id.toString()).toBe(doc1._id.toString());

      // Verify duplicates were backed up
      const backups = await mongoose.connection.db
        .collection("visits_duplicates_backup")
        .find({})
        .toArray();

      expect(backups).toHaveLength(2);
      expect(backups[0]._backup_reason).toBe("duplicate_event_key");
      expect(backups[0]._kept_record_id.toString()).toBe(doc1._id.toString());
      expect(backups[1]._backup_reason).toBe("duplicate_event_key");
      expect(backups[1]._kept_record_id.toString()).toBe(doc1._id.toString());
    });

    it("should handle missing createdAt by treating as oldest", async () => {
      const eventKey = "duplicate_event_key_789";

      // Create duplicates where one is missing createdAt
      // Use insertOne to bypass timestamps: true which auto-adds createdAt
      const doc1Result = await mongoose.connection.db
        .collection("visits")
        .insertOne({
          id: "dux1",
          userid: "user1",
          time: new Date("2024-01-15"),
          VisitTime: new Date("2024-01-15"),
          "First Name": "John",
          Degree: "1st",
          event_key: eventKey,
          rawData: { type: "visit" },
          // No createdAt - should default to epoch (oldest)
        });
      const doc1 = { _id: doc1Result.insertedId };

      const doc2 = await Visit.create(
        createVisitData({
          id: "dux2",
          time: new Date("2024-01-16"),
          VisitTime: new Date("2024-01-16"),
          event_key: eventKey,
          createdAt: new Date("2024-01-15"), // Has createdAt
        }),
      );

      const { groups } = await identifyDuplicates(Visit, "visits");
      const results = await removeDuplicates(Visit, "visits", groups, false);

      expect(results.kept).toBe(1);
      expect(results.removed).toBe(1);

      // Verify record without createdAt was kept (treated as oldest)
      const remaining = await Visit.find({}).lean();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]._id.toString()).toBe(doc1._id.toString());
      expect(remaining[0].createdAt).toBeUndefined();
    });

    it("should run full workflow end-to-end", async () => {
      // Create realistic scenario with duplicates already having event_keys
      // This simulates what happens after initial webhook processing created duplicates
      const duplicateEventKey = "existing_duplicate_key_abc123";

      // Use insertMany to bypass unique index and create duplicates
      await mongoose.connection.db.collection("visits").insertMany([
        {
          ...createVisitData({
            id: "dux_duplicate",
            userid: "user1",
            time: new Date("2024-01-15T10:00:00Z"),
            VisitTime: new Date("2024-01-15T10:00:00Z"),
          }),
          event_key: duplicateEventKey,
          createdAt: new Date("2024-01-10"), // Oldest duplicate
        },
        {
          ...createVisitData({
            id: "dux_duplicate2",
            userid: "user1",
            time: new Date("2024-01-15T10:00:00Z"),
            VisitTime: new Date("2024-01-15T10:00:00Z"),
          }),
          event_key: duplicateEventKey,
          createdAt: new Date("2024-01-20"), // Newer duplicate
        },
        {
          ...createVisitData({
            id: "dux_unique",
            userid: "user1",
            time: new Date("2024-01-16T10:00:00Z"),
            VisitTime: new Date("2024-01-16T10:00:00Z"),
          }),
          event_key: "unique_key_def456",
          createdAt: new Date("2024-01-15"),
        },
      ]);

      // Phase 1: Analyze
      const analysis = await analyzeCollection(Visit, "visits");
      expect(analysis.total).toBe(3);
      expect(analysis.withEventKey).toBe(3);

      // Phase 3: Identify duplicates (skip Phase 2 since we already have event_keys)
      const { groups, totalDuplicates } = await identifyDuplicates(
        Visit,
        "visits",
      );
      expect(groups.length).toBe(1); // One group of duplicates
      expect(totalDuplicates).toBe(1); // 2 records - 1 to keep = 1 to remove

      // Phase 4: Remove duplicates
      const removalResults = await removeDuplicates(
        Visit,
        "visits",
        groups,
        false,
      );
      expect(removalResults.removed).toBe(1); // One duplicate removed
      expect(removalResults.kept).toBe(1); // One duplicate kept

      // Final verification
      const remaining = await Visit.find({}).lean();
      expect(remaining).toHaveLength(2); // 2 unique records remain

      // All remaining records should have event_key
      remaining.forEach((record) => {
        expect(record.event_key).toBeTruthy();
      });

      // All event_keys should be unique
      const eventKeys = remaining.map((r) => r.event_key);
      const uniqueEventKeys = new Set(eventKeys);
      expect(uniqueEventKeys.size).toBe(eventKeys.length);
    });
  });

  describe("Full Deduplication Workflow - Scans", () => {
    beforeEach(async () => {
      await Scan.deleteMany({});
      await mongoose.connection.db
        .collection("scans_duplicates_backup")
        .deleteMany({});
    });

    it("should handle Scan collection with ScanTime field", async () => {
      // Create scan records (use ScanTime instead of VisitTime)
      await Scan.create([
        createScanData({
          id: "scan1",
          time: new Date("2024-01-15"),
          ScanTime: new Date("2024-01-15"),
        }),
        createScanData({
          id: "scan2",
          time: new Date("2024-01-16"),
          ScanTime: new Date("2024-01-16"),
        }),
      ]);

      const backfillResults = await backfillEventKeys(Scan, "scans", false);

      expect(backfillResults.backfilled).toBe(2);

      // Verify event_keys were computed correctly using ScanTime
      const scans = await Scan.find({}).lean();
      scans.forEach((scan) => {
        expect(scan.event_key).toBeTruthy();
        expect(scan.event_key).toHaveLength(40);
      });
    });

    it("should differentiate scan vs visit event_keys by type", async () => {
      // Create one scan and one visit with same id/user/time
      const sharedData = {
        id: "shared_id",
        userid: "user1",
        time: new Date("2024-01-15T10:00:00Z"),
      };

      await Visit.create(
        createVisitData({
          ...sharedData,
          VisitTime: new Date("2024-01-15T10:00:00Z"),
        }),
      );

      await Scan.create(
        createScanData({
          ...sharedData,
          ScanTime: new Date("2024-01-15T10:00:00Z"),
        }),
      );

      // Backfill both
      await backfillEventKeys(Visit, "visits", false);
      await backfillEventKeys(Scan, "scans", false);

      const visit = await Visit.findOne({}).lean();
      const scan = await Scan.findOne({}).lean();

      // Event keys should be different due to type field
      expect(visit.event_key).toBeTruthy();
      expect(scan.event_key).toBeTruthy();
      expect(visit.event_key).not.toBe(scan.event_key);
    });
  });

  describe("Dry Run Mode", () => {
    beforeEach(async () => {
      await Visit.deleteMany({});

      // Drop the unique index on event_key to allow creating duplicates for testing
      try {
        await mongoose.connection.db
          .collection("visits")
          .dropIndex("event_key_1");
      } catch (err) {
        // Index might not exist, ignore error
      }
    });

    afterEach(async () => {
      // Recreate the unique sparse index after each test
      try {
        await mongoose.connection.db
          .collection("visits")
          .createIndex({ event_key: 1 }, { unique: true, sparse: true });
      } catch (err) {
        // Index might already exist, ignore error
      }
    });

    it("should not make changes in dry-run mode during backfill", async () => {
      await Visit.create([
        createVisitData({
          id: "dux1",
          time: new Date("2024-01-15"),
          VisitTime: new Date("2024-01-15"),
        }),
      ]);

      // Run in dry-run mode (dryRun = true)
      const results = await backfillEventKeys(Visit, "visits", true);

      expect(results.backfilled).toBe(1); // Reports what would be done

      // Verify NO changes were made
      const visit = await Visit.findOne({}).lean();
      expect(visit.event_key).toBeUndefined();
    });

    it("should not remove duplicates in dry-run mode", async () => {
      const eventKey = "duplicate_key";

      // Use insertMany to bypass unique index constraint
      await mongoose.connection.db.collection("visits").insertMany([
        {
          ...createVisitData({
            id: "dux1",
            time: new Date("2024-01-15"),
            VisitTime: new Date("2024-01-15"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-10"),
        },
        {
          ...createVisitData({
            id: "dux2",
            time: new Date("2024-01-16"),
            VisitTime: new Date("2024-01-16"),
          }),
          event_key: eventKey,
          createdAt: new Date("2024-01-15"),
        },
      ]);

      const { groups } = await identifyDuplicates(Visit, "visits");

      // Run removal in dry-run mode
      const results = await removeDuplicates(Visit, "visits", groups, true);

      expect(results.removed).toBe(0); // Nothing actually removed

      // Verify both records still exist
      const remaining = await Visit.find({}).lean();
      expect(remaining).toHaveLength(2);
    });
  });
});
