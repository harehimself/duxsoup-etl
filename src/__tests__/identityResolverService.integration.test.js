const identityResolverService = require("../services/identityResolverService");
const Person = require("../models/person");
const Merge = require("../models/merge");
const mongoose = require("mongoose");
const {
  buildCanonicalKey,
  computeCanonicalId,
} = require("../utils/identityMatcher");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");

const canonicalIdFor = (type, value) =>
  computeCanonicalId(buildCanonicalKey(type, value));

describe("IdentityResolverService", () => {
  beforeAll(async () => {
    await connect();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("findByAnyAlias()", () => {
    it("should find person by Sales Navigator ID alias", async () => {
      // Arrange
      const person = await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [
          { type: "salesNavId", value: "ACwAAABCDEF" },
          { type: "publicUrl", value: "linkedin.com/in/johndoe" },
        ],
        snapshot: {},
      });

      const aliases = [{ type: "salesNavId", value: "ACwAAABCDEF" }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe(person._id);
    });

    it("should find person by numeric ID alias", async () => {
      // Arrange
      await Person.create({
        _id: "12345678",
        person_id: "12345678",
        canonical_id: canonicalIdFor("numericId", "12345678"),
        aliases: [
          { type: "numericId", value: "12345678" },
          { type: "publicUrl", value: "linkedin.com/in/janedoe" },
        ],
        snapshot: {},
      });

      const aliases = [{ type: "numericId", value: "12345678" }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]._id).toBe("12345678");
    });

    it("should find person by public URL alias", async () => {
      // Arrange
      await Person.create({
        _id: "ACwAAAXYZ",
        person_id: "ACwAAAXYZ",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAAXYZ"),
        aliases: [
          { type: "salesNavId", value: "ACwAAAXYZ" },
          { type: "publicUrl", value: "linkedin.com/in/johndoe" },
        ],
        snapshot: {},
      });

      const aliases = [{ type: "publicUrl", value: "linkedin.com/in/johndoe" }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].aliases).toContainEqual(
        expect.objectContaining({
          type: "publicUrl",
          value: "linkedin.com/in/johndoe",
        }),
      );
    });

    it("should find multiple people when aliases match different persons", async () => {
      // Arrange
      await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
        snapshot: {},
      });

      await Person.create({
        _id: "ACwAAAXYZ",
        person_id: "ACwAAAXYZ",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAAXYZ"),
        aliases: [{ type: "salesNavId", value: "ACwAAAXYZ" }],
        snapshot: {},
      });

      const aliases = [
        { type: "salesNavId", value: "ACwAAABCDEF" },
        { type: "salesNavId", value: "ACwAAAXYZ" },
      ];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toHaveLength(2);
    });

    it("should return empty array when no aliases match", async () => {
      // Arrange
      const aliases = [{ type: "salesNavId", value: "ACwAAA_NONEXISTENT" }];

      // Act
      const results = await identityResolverService.findByAnyAlias(aliases);

      // Assert
      expect(results).toEqual([]);
    });
  });

  describe("mergeAliases()", () => {
    it("should add new aliases to person without duplicates", async () => {
      // Arrange
      const person = await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
        snapshot: {},
      });

      const newAliases = [
        { type: "publicUrl", value: "linkedin.com/in/johndoe" },
        { type: "numericId", value: "12345678" },
      ];

      // Act
      const updated = await identityResolverService.mergeAliases(
        person,
        newAliases,
      );

      // Assert
      expect(updated.aliases).toHaveLength(3);
      expect(updated.aliases).toContainEqual(
        expect.objectContaining({
          type: "publicUrl",
          value: "linkedin.com/in/johndoe",
        }),
      );
    });

    it("should not add duplicate aliases", async () => {
      // Arrange
      const person = await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [
          { type: "salesNavId", value: "ACwAAABCDEF" },
          { type: "publicUrl", value: "linkedin.com/in/johndoe" },
        ],
        snapshot: {},
      });

      const newAliases = [
        { type: "publicUrl", value: "linkedin.com/in/johndoe" }, // Duplicate
      ];

      // Act
      const updated = await identityResolverService.mergeAliases(
        person,
        newAliases,
      );

      // Assert
      expect(updated.aliases).toHaveLength(2); // No new aliases added
    });
  });

  describe("determineWinner()", () => {
    it("should prefer person with Sales Navigator ID format", () => {
      // Arrange — use a realistic-length Sales Nav ID (10+ chars after prefix)
      const personWithSalesNav = {
        _id: "ACwAABjK8PoBZx4nYtR2jLmQw5vX",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const personWithoutSalesNav = {
        _id: "12345678",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-02"), // More recent
      };

      // Act
      const winner = identityResolverService.determineWinner([
        personWithoutSalesNav,
        personWithSalesNav,
      ]);

      // Assert
      expect(winner._id).toBe("ACwAABjK8PoBZx4nYtR2jLmQw5vX");
    });

    it("should prefer person with most observations", () => {
      // Arrange
      const personWithMoreObs = {
        _id: "12345678",
        observations: { visits: ["v1", "v2"], scans: ["s1"] },
        updatedAt: new Date("2024-01-01"),
      };

      const personWithLessObs = {
        _id: "87654321",
        observations: { visits: ["v1"], scans: [] },
        updatedAt: new Date("2024-01-02"),
      };

      // Act
      const winner = identityResolverService.determineWinner([
        personWithLessObs,
        personWithMoreObs,
      ]);

      // Assert
      expect(winner._id).toBe("12345678");
    });

    it("should prefer most recently updated when observations equal", () => {
      // Arrange
      const olderPerson = {
        _id: "12345678",
        observations: { visits: ["v1"], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const newerPerson = {
        _id: "87654321",
        observations: { visits: ["v1"], scans: [] },
        updatedAt: new Date("2024-01-15"),
      };

      // Act
      const winner = identityResolverService.determineWinner([
        olderPerson,
        newerPerson,
      ]);

      // Assert
      expect(winner._id).toBe("87654321");
    });

    it("should use lexical tie-breaker when all else equal", () => {
      // Arrange
      const personA = {
        _id: "linkedin.com/in/b-person",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const personB = {
        _id: "linkedin.com/in/a-person",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      // Act
      const winner = identityResolverService.determineWinner([
        personA,
        personB,
      ]);

      // Assert
      expect(winner._id).toBe("linkedin.com/in/a-person");
    });

    it("should not treat short username-prefixed IDs as Sales Nav IDs", () => {
      // ACoAAlex is a username, not a real Sales Nav ID
      const usernameWithPrefix = {
        _id: "ACoAAlex",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const numericIdPerson = {
        _id: "12345678",
        observations: { visits: ["v1", "v2"], scans: [] },
        updatedAt: new Date("2024-01-02"),
      };

      // Act — numeric ID person has more observations, should win
      const winner = identityResolverService.determineWinner([
        usernameWithPrefix,
        numericIdPerson,
      ]);

      // Assert — ACoAAlex should NOT be treated as Sales Nav ID
      expect(winner._id).toBe("12345678");
    });

    it("should not treat ACwAABob as a Sales Nav ID", () => {
      const usernameWithPrefix = {
        _id: "ACwAABob",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const numericIdPerson = {
        _id: "87654321",
        observations: { visits: ["v1"], scans: [] },
        updatedAt: new Date("2024-01-02"),
      };

      // Act
      const winner = identityResolverService.determineWinner([
        usernameWithPrefix,
        numericIdPerson,
      ]);

      // Assert — ACwAABob is too short, numeric ID with more obs wins
      expect(winner._id).toBe("87654321");
    });

    it("should recognize real Sales Nav IDs with 10+ chars after prefix", () => {
      const realSalesNavId = {
        _id: "ACoAAA0CM4MBva7a",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const numericIdPerson = {
        _id: "99999999",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-02"), // More recent
      };

      // Act
      const winner = identityResolverService.determineWinner([
        numericIdPerson,
        realSalesNavId,
      ]);

      // Assert — real Sales Nav ID should win despite older updatedAt
      expect(winner._id).toBe("ACoAAA0CM4MBva7a");
    });

    it("should not match bare prefix with no suffix as Sales Nav ID", () => {
      const barePrefix = {
        _id: "ACoAA",
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      const numericIdPerson = {
        _id: "11111111",
        observations: { visits: ["v1"], scans: [] },
        updatedAt: new Date("2024-01-01"),
      };

      // Act
      const winner = identityResolverService.determineWinner([
        barePrefix,
        numericIdPerson,
      ]);

      // Assert — bare prefix is not a Sales Nav ID
      expect(winner._id).toBe("11111111");
    });
  });

  describe("mergePeople()", () => {
    it("should merge two people and create audit record", async () => {
      // Arrange
      const winner = await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
        snapshot: { fullName: "John Doe" },
        observations: { visits: [], scans: [] },
      });

      const loser = await Person.create({
        _id: "linkedin.com/in/johndoe",
        person_id: "linkedin.com/in/johndoe",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/johndoe"),
        aliases: [{ type: "publicUrl", value: "linkedin.com/in/johndoe" }],
        snapshot: { fullName: "John Doe" },
        observations: { visits: [], scans: [] },
      });

      // Act
      const result = await identityResolverService.mergePeople(
        winner,
        [loser],
        {
          reason: "alias_conflict",
        },
      );

      // Assert
      expect(result._id).toBe("ACwAAABCDEF");
      expect(result.aliases).toHaveLength(2);

      // Verify loser was deleted
      const deletedPerson = await Person.findById("linkedin.com/in/johndoe");
      expect(deletedPerson).toBeNull();

      // Verify audit record
      const mergeRecord = await Merge.findOne({ winner_id: "ACwAAABCDEF" });
      expect(mergeRecord).toBeTruthy();
      expect(mergeRecord.loser_ids).toContain("linkedin.com/in/johndoe");
    });

    it("should combine observations from all merged people", async () => {
      // Arrange
      const visit1 = new mongoose.Types.ObjectId();
      const scan1 = new mongoose.Types.ObjectId();
      const visit2 = new mongoose.Types.ObjectId();
      const scan2 = new mongoose.Types.ObjectId();

      const winner = await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
        snapshot: {},
        observations: { visits: [visit1], scans: [scan1] },
      });

      const loser = await Person.create({
        _id: "12345678",
        person_id: "12345678",
        canonical_id: canonicalIdFor("numericId", "12345678"),
        aliases: [{ type: "numericId", value: "12345678" }],
        snapshot: {},
        observations: { visits: [visit2], scans: [scan2] },
      });

      // Act
      const result = await identityResolverService.mergePeople(winner, [loser]);

      // Assert
      const visitIds = result.observations.visits.map((id) => id.toString());
      const scanIds = result.observations.scans.map((id) => id.toString());

      expect(visitIds).toHaveLength(2);
      expect(scanIds).toHaveLength(2);
      expect(visitIds).toContain(visit1.toString());
      expect(visitIds).toContain(visit2.toString());
    });
  });

  describe("resolveOrCreate()", () => {
    it("should return existing person when exact _id matches", async () => {
      // Arrange
      const existing = await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
        snapshot: {},
      });

      const identity = {
        person_id: "ACwAAABCDEF",
        aliases: [{ type: "salesNavId", value: "ACwAAABCDEF" }],
        source: "salesNavId",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
      };

      // Act
      const result = await identityResolverService.resolveOrCreate(identity);

      // Assert
      expect(result._id).toBe(existing._id);
    });

    it("should create new person when no matches found", async () => {
      // Arrange
      const identity = {
        person_id: "ACwAAANEW",
        aliases: [{ type: "salesNavId", value: "ACwAAANEW" }],
        source: "salesNavId",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAANEW"),
      };

      // Act
      const result = await identityResolverService.resolveOrCreate(identity);

      // Assert
      expect(result._id).toBe("ACwAAANEW");
      expect(result.aliases).toHaveLength(1);

      // Verify it was saved to DB
      const saved = await Person.findById("ACwAAANEW");
      expect(saved).toBeTruthy();
    });

    it("should merge when multiple people share an alias", async () => {
      // Arrange: Two people with different primary IDs but overlapping aliases
      await Person.create({
        _id: "ACwAAABCDEF",
        person_id: "ACwAAABCDEF",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAABCDEF"),
        aliases: [
          { type: "salesNavId", value: "ACwAAABCDEF" },
          { type: "publicUrl", value: "linkedin.com/in/johndoe" },
        ],
        snapshot: {},
        observations: { visits: [new mongoose.Types.ObjectId()], scans: [] },
        updatedAt: new Date("2024-01-15"),
      });

      await Person.create({
        _id: "12345678",
        person_id: "12345678",
        canonical_id: canonicalIdFor("numericId", "12345678"),
        aliases: [
          { type: "numericId", value: "12345678" },
          { type: "publicUrl", value: "linkedin.com/in/johndoe" }, // Same public URL!
        ],
        snapshot: {},
        observations: { visits: [], scans: [] },
        updatedAt: new Date("2024-01-01"),
      });

      const identity = {
        person_id: "linkedin.com/in/johndoe",
        aliases: [{ type: "publicUrl", value: "linkedin.com/in/johndoe" }],
        source: "publicUrl",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/johndoe"),
      };

      // Act
      const result = await identityResolverService.resolveOrCreate(identity);

      // Assert: Winner should be ACwAAABCDEF (Sales Nav ID preferred)
      expect(result._id).toBe("ACwAAABCDEF");

      // Verify only one person exists now
      const allPeople = await Person.find({});
      expect(allPeople).toHaveLength(1);

      // Verify merge audit record
      const mergeRecord = await Merge.findOne({ winner_id: "ACwAAABCDEF" });
      expect(mergeRecord).toBeTruthy();
      expect(mergeRecord.loser_ids).toContain("12345678");
    });
  });

  describe("findSalesNavIdDuplicates()", () => {
    it("finds duplicates using extracted salesNavId and ignores unique records", async () => {
      await Person.create({
        _id: "ACwAAA111",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAA111"),
        aliases: [{ type: "salesNavId", value: "ACwAAA111" }],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      await Person.create({
        _id: "linkedin.com/in/jane-doe",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/jane-doe"),
        aliases: [
          {
            type: "salesUrl",
            value: "www.linkedin.com/sales/lead/acwaaa111,NAME_SEARCH,Z1JY",
          },
        ],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      await Person.create({
        _id: "linkedin.com/in/john-doe",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/john-doe"),
        aliases: [
          { type: "publicUrl", value: "www.linkedin.com/in/ACwAAA111" },
        ],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      await Person.create({
        _id: "12345678",
        canonical_id: canonicalIdFor("numericId", "12345678"),
        aliases: [{ type: "numericId", value: "12345678" }],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      const duplicates =
        await identityResolverService.findSalesNavIdDuplicates();
      const groupsById = Object.fromEntries(
        duplicates.map((group) => [group.salesNavId, group.people]),
      );

      expect(Object.keys(groupsById)).toEqual(["ACwAAA111"]);
      expect(groupsById.ACwAAA111).toHaveLength(3);

      const duplicateIds = groupsById.ACwAAA111.map((person) => person._id);
      expect(duplicateIds).toEqual(
        expect.arrayContaining([
          "ACwAAA111",
          "linkedin.com/in/jane-doe",
          "linkedin.com/in/john-doe",
        ]),
      );
    });

    it("groups merged person with multiple salesNavId aliases under each ID", async () => {
      // Simulate a merged person carrying TWO salesNavIds (e.g., after merge)
      await Person.create({
        _id: "merged-person",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAA111"),
        aliases: [
          { type: "salesNavId", value: "ACwAAA111" },
          { type: "salesNavId", value: "ACwAAA222" }, // Second ID from merge
        ],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      // Create another person with ACwAAA111 to make it a duplicate
      await Person.create({
        _id: "person-111",
        canonical_id: canonicalIdFor("salesNavId", "person-111"),
        aliases: [{ type: "salesNavId", value: "ACwAAA111" }],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      // Create another person with ACwAAA222 to make it a duplicate
      await Person.create({
        _id: "person-222",
        canonical_id: canonicalIdFor("salesNavId", "person-222"),
        aliases: [{ type: "salesNavId", value: "ACwAAA222" }],
        snapshot: {},
        observations: { visits: [], scans: [] },
      });

      const duplicates =
        await identityResolverService.findSalesNavIdDuplicates();
      const groupsById = Object.fromEntries(
        duplicates.map((group) => [group.salesNavId, group.people]),
      );

      // The merged person should appear in BOTH duplicate groups
      expect(Object.keys(groupsById).sort()).toEqual([
        "ACwAAA111",
        "ACwAAA222",
      ]);

      // ACwAAA111 group: merged person + person-111
      expect(groupsById.ACwAAA111).toHaveLength(2);
      const ids111 = groupsById.ACwAAA111.map((p) => p._id).sort();
      expect(ids111).toEqual(["merged-person", "person-111"]);

      // ACwAAA222 group: merged person + person-222
      expect(groupsById.ACwAAA222).toHaveLength(2);
      const ids222 = groupsById.ACwAAA222.map((p) => p._id).sort();
      expect(ids222).toEqual(["merged-person", "person-222"]);

      // Verify the merged person appears in both groups (this would fail before the fix)
      expect(groupsById.ACwAAA111.some((p) => p._id === "merged-person")).toBe(
        true,
      );
      expect(groupsById.ACwAAA222.some((p) => p._id === "merged-person")).toBe(
        true,
      );
    });
  });

  describe("mergePeople() safety validation", () => {
    it("should block merge and return winner unchanged when observation disparity detected", async () => {
      // Winner has 0 observations, loser has 5
      const winner = await Person.create({
        _id: "ACwAAAWinner",
        person_id: "ACwAAAWinner",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAAWinner"),
        aliases: [{ type: "salesNavId", value: "ACwAAAWinner" }],
        snapshot: { fullName: "Alice Test" },
        observations: { visits: [], scans: [] },
      });

      const loserVisits = Array.from(
        { length: 5 },
        () => new mongoose.Types.ObjectId(),
      );
      const loser = await Person.create({
        _id: "linkedin.com/in/alice-test",
        person_id: "linkedin.com/in/alice-test",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/alice-test"),
        aliases: [{ type: "publicUrl", value: "linkedin.com/in/alice-test" }],
        snapshot: { fullName: "Alice Test" },
        observations: { visits: loserVisits, scans: [] },
      });

      const result = await identityResolverService.mergePeople(
        winner,
        [loser],
        {
          reason: "alias_conflict",
        },
      );

      // Winner returned unchanged
      expect(result._id).toBe("ACwAAAWinner");
      expect(result.aliases).toHaveLength(1);

      // Loser NOT deleted
      const loserStillExists = await Person.findById(
        "linkedin.com/in/alice-test",
      );
      expect(loserStillExists).toBeTruthy();

      // No merge audit record created
      const mergeRecord = await Merge.findOne({ winner_id: "ACwAAAWinner" });
      expect(mergeRecord).toBeNull();
    });

    it("should proceed with merge when force is set despite blockers", async () => {
      // Winner has 0 observations, loser has 5 — would normally block
      const winner = await Person.create({
        _id: "ACwAAAForceWin",
        person_id: "ACwAAAForceWin",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAAForceWin"),
        aliases: [{ type: "salesNavId", value: "ACwAAAForceWin" }],
        snapshot: { fullName: "Bob Force" },
        observations: { visits: [], scans: [] },
      });

      const loserVisits = Array.from(
        { length: 5 },
        () => new mongoose.Types.ObjectId(),
      );
      const loser = await Person.create({
        _id: "linkedin.com/in/bob-force",
        person_id: "linkedin.com/in/bob-force",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/bob-force"),
        aliases: [{ type: "publicUrl", value: "linkedin.com/in/bob-force" }],
        snapshot: { fullName: "Bob Force" },
        observations: { visits: loserVisits, scans: [] },
      });

      const result = await identityResolverService.mergePeople(
        winner,
        [loser],
        {
          reason: "alias_conflict",
          force: true,
        },
      );

      // Merge proceeded
      expect(result._id).toBe("ACwAAAForceWin");
      expect(result.aliases).toHaveLength(2);

      // Loser deleted
      const loserDeleted = await Person.findById("linkedin.com/in/bob-force");
      expect(loserDeleted).toBeNull();

      // Merge audit record created
      const mergeRecord = await Merge.findOne({ winner_id: "ACwAAAForceWin" });
      expect(mergeRecord).toBeTruthy();
    });

    it("should attach safety warnings to merge audit metadata", async () => {
      // Winner and loser have different companies — warning, not blocker
      const winner = await Person.create({
        _id: "ACwAAAWarnWin",
        person_id: "ACwAAAWarnWin",
        canonical_id: canonicalIdFor("salesNavId", "ACwAAAWarnWin"),
        aliases: [{ type: "salesNavId", value: "ACwAAAWarnWin" }],
        snapshot: { fullName: "Carol Warn", currentCompany: "Acme Corp" },
        observations: { visits: [new mongoose.Types.ObjectId()], scans: [] },
      });

      const loser = await Person.create({
        _id: "linkedin.com/in/carol-warn",
        person_id: "linkedin.com/in/carol-warn",
        canonical_id: canonicalIdFor("publicUrl", "linkedin.com/in/carol-warn"),
        aliases: [{ type: "publicUrl", value: "linkedin.com/in/carol-warn" }],
        snapshot: { fullName: "Carol Warn", currentCompany: "Globex Inc" },
        observations: { visits: [new mongoose.Types.ObjectId()], scans: [] },
      });

      const result = await identityResolverService.mergePeople(
        winner,
        [loser],
        {
          reason: "alias_conflict",
        },
      );

      // Merge proceeded (only warning, no blocker)
      expect(result._id).toBe("ACwAAAWarnWin");
      expect(result.aliases).toHaveLength(2);

      // Loser deleted
      const loserDeleted = await Person.findById("linkedin.com/in/carol-warn");
      expect(loserDeleted).toBeNull();

      // Merge audit record has safety warnings in metadata
      const mergeRecord = await Merge.findOne({ winner_id: "ACwAAAWarnWin" });
      expect(mergeRecord).toBeTruthy();
      expect(mergeRecord.metadata).toBeTruthy();
      expect(mergeRecord.metadata.safetyWarnings).toBeTruthy();
      expect(mergeRecord.metadata.safetyWarnings.length).toBeGreaterThan(0);
      expect(mergeRecord.metadata.safetyWarnings[0]).toContain(
        "Company mismatch",
      );
    });
  });
});
