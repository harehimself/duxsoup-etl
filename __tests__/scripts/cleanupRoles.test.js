const {
  deduplicateCorruptedDateRoles,
  fixStaleIsCurrentFlags,
  reParseSeniority,
  computeDerivedMetrics,
  isLikelyCorruptedDate,
  normalizeRoleText,
} = require("../../scripts/cleanupRoles");

describe("cleanupRoles", () => {
  describe("isLikelyCorruptedDate()", () => {
    it("should flag dates in 2000-2002 as corrupted", () => {
      expect(isLikelyCorruptedDate(new Date("2001-02-22"))).toBe(true);
      expect(isLikelyCorruptedDate(new Date("2000-01-15"))).toBe(true);
      expect(isLikelyCorruptedDate(new Date("2002-12-31"))).toBe(true);
    });

    it("should not flag legitimate dates", () => {
      expect(isLikelyCorruptedDate(new Date("2020-01-01"))).toBe(false);
      expect(isLikelyCorruptedDate(new Date("2010-06-15"))).toBe(false);
      expect(isLikelyCorruptedDate(new Date("2025-03-01"))).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isLikelyCorruptedDate(null)).toBe(false);
      expect(isLikelyCorruptedDate(undefined)).toBe(false);
    });

    it("should handle date strings", () => {
      expect(isLikelyCorruptedDate("2001-03-15")).toBe(true);
      expect(isLikelyCorruptedDate("2022-01-01")).toBe(false);
    });
  });

  describe("normalizeRoleText()", () => {
    it("should lowercase and collapse whitespace", () => {
      expect(normalizeRoleText("  VP  of  Sales ")).toBe("vp of sales");
    });

    it("should return empty string for null", () => {
      expect(normalizeRoleText(null)).toBe("");
    });
  });

  describe("deduplicateCorruptedDateRoles()", () => {
    it("should remove duplicate roles with corrupted 2001 dates", () => {
      const roles = [
        {
          title: "Account Executive",
          companyName: "Five9",
          startDate: new Date("2022-02-01"),
          endDate: new Date("2023-03-01"),
          isCurrent: false,
        },
        {
          title: "Account Executive",
          companyName: "Five9",
          startDate: new Date("2001-02-22"),
          endDate: null,
          isCurrent: true,
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      expect(removedCount).toBe(1);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].startDate).toEqual(new Date("2022-02-01"));
    });

    it("should keep all roles when no corrupted dates exist", () => {
      const roles = [
        {
          title: "AE",
          companyName: "Acme",
          startDate: new Date("2020-01-01"),
          endDate: new Date("2022-01-01"),
        },
        {
          title: "VP",
          companyName: "Acme",
          startDate: new Date("2022-01-01"),
          isCurrent: true,
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      expect(removedCount).toBe(0);
      expect(deduped).toHaveLength(2);
    });

    it("should handle multiple corrupted copies of the same role", () => {
      const roles = [
        {
          title: "VP Sales",
          companyName: "Verint",
          startDate: new Date("2019-12-01"),
          endDate: new Date("2021-02-01"),
          isCurrent: false,
          description: "Real description",
        },
        {
          title: "VP Sales",
          companyName: "Verint",
          startDate: new Date("2001-12-19"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "VP Sales",
          companyName: "Verint",
          startDate: new Date("2001-01-01"),
          endDate: null,
          isCurrent: true,
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      expect(removedCount).toBe(2);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].startDate).toEqual(new Date("2019-12-01"));
      expect(deduped[0].description).toBe("Real description");
    });

    it("should backfill missing fields from corrupted copy to real copy", () => {
      const roles = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: new Date("2022-01-01"),
          location: null,
          description: null,
        },
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: new Date("2001-01-22"),
          location: "New York",
          description: "Built things",
        },
      ];

      const { deduped } = deduplicateCorruptedDateRoles(roles);

      expect(deduped).toHaveLength(1);
      expect(deduped[0].location).toBe("New York");
      expect(deduped[0].description).toBe("Built things");
    });

    it("should keep only one copy when all have corrupted dates", () => {
      const roles = [
        {
          title: "Manager",
          companyName: "Corp",
          startDate: new Date("2001-01-10"),
        },
        {
          title: "Manager",
          companyName: "Corp",
          startDate: new Date("2001-03-14"),
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      expect(removedCount).toBe(1);
      expect(deduped).toHaveLength(1);
    });

    it("should handle empty roles array", () => {
      const { deduped, removedCount } = deduplicateCorruptedDateRoles([]);
      expect(removedCount).toBe(0);
      expect(deduped).toHaveLength(0);
    });

    it("should handle null roles", () => {
      const { deduped, removedCount } = deduplicateCorruptedDateRoles(null);
      expect(removedCount).toBe(0);
      expect(deduped).toBeNull();
    });

    it("should match title+company case-insensitively", () => {
      const roles = [
        {
          title: "Account Executive",
          companyName: "Five9",
          startDate: new Date("2022-02-01"),
        },
        {
          title: "account executive",
          companyName: "five9",
          startDate: new Date("2001-02-22"),
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      expect(removedCount).toBe(1);
      expect(deduped).toHaveLength(1);
    });

    it("should keep different roles at the same company", () => {
      const roles = [
        {
          title: "AE",
          companyName: "Verint",
          startDate: new Date("2015-03-01"),
        },
        {
          title: "RVP Sales",
          companyName: "Verint",
          startDate: new Date("2019-12-01"),
        },
        {
          title: "AE",
          companyName: "Verint",
          startDate: new Date("2001-03-15"),
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      // AE corrupted copy removed, RVP kept (no duplicate)
      expect(removedCount).toBe(1);
      expect(deduped).toHaveLength(2);
    });

    it("should not merge roles with no start dates", () => {
      const roles = [
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: null,
          isCurrent: true,
        },
        {
          title: "Engineer",
          companyName: "Corp",
          startDate: null,
          isCurrent: false,
        },
      ];

      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);

      expect(removedCount).toBe(0);
      expect(deduped).toHaveLength(2);
    });
  });

  describe("fixStaleIsCurrentFlags()", () => {
    it("should flip isCurrent when role has endDate", () => {
      const roles = [
        {
          title: "VP",
          companyName: "OldCo",
          startDate: new Date("2018-01-01"),
          endDate: new Date("2020-01-01"),
          isCurrent: true,
        },
        {
          title: "VP",
          companyName: "NewCo",
          startDate: new Date("2020-01-01"),
          endDate: null,
          isCurrent: true,
        },
      ];

      const flipped = fixStaleIsCurrentFlags(roles);

      expect(flipped).toBe(1);
      expect(roles[0].isCurrent).toBe(false);
      expect(roles[1].isCurrent).toBe(true);
    });

    it("should keep single current role unchanged", () => {
      const roles = [
        {
          title: "AE",
          companyName: "Corp",
          startDate: new Date("2025-01-01"),
          isCurrent: true,
        },
      ];

      const flipped = fixStaleIsCurrentFlags(roles);

      expect(flipped).toBe(0);
      expect(roles[0].isCurrent).toBe(true);
    });

    it("should flip older current roles at different companies", () => {
      const roles = [
        {
          title: "AE",
          companyName: "Genesys",
          startDate: new Date("2025-01-01"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "Director",
          companyName: "OpenFin",
          startDate: new Date("2023-04-01"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "Director",
          companyName: "Five9",
          startDate: new Date("2022-02-01"),
          endDate: null,
          isCurrent: true,
        },
      ];

      const flipped = fixStaleIsCurrentFlags(roles);

      expect(flipped).toBe(2);
      expect(roles[0].isCurrent).toBe(true); // Genesys: most recent
      expect(roles[1].isCurrent).toBe(false); // OpenFin: different company
      expect(roles[2].isCurrent).toBe(false); // Five9: different company
    });

    it("should keep multiple current roles at the SAME company", () => {
      const roles = [
        {
          title: "AE",
          companyName: "Verint",
          startDate: new Date("2019-12-01"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "VP Sales",
          companyName: "Verint",
          startDate: new Date("2015-03-01"),
          endDate: null,
          isCurrent: true,
        },
      ];

      const flipped = fixStaleIsCurrentFlags(roles);

      // Both at Verint — keep both current
      expect(flipped).toBe(0);
      expect(roles[0].isCurrent).toBe(true);
      expect(roles[1].isCurrent).toBe(true);
    });

    it("should handle no current roles", () => {
      const roles = [
        {
          title: "AE",
          companyName: "Corp",
          isCurrent: false,
        },
      ];

      const flipped = fixStaleIsCurrentFlags(roles);
      expect(flipped).toBe(0);
    });

    it("should handle empty array", () => {
      expect(fixStaleIsCurrentFlags([])).toBe(0);
    });

    it("should handle null", () => {
      expect(fixStaleIsCurrentFlags(null)).toBe(0);
    });
  });

  describe("reParseSeniority()", () => {
    it("should parse RVP as VP tier", () => {
      const roles = [
        {
          title: "RVP Sales, Intelligent Self Service",
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
      ];

      const changed = reParseSeniority(roles);

      expect(changed).toBe(1);
      expect(roles[0].seniority).toBe("VP");
      expect(roles[0].seniorityRank).toBe(5);
    });

    it("should parse Regional Vice President as VP tier", () => {
      const roles = [
        {
          title: "Regional Vice President, Sales",
          seniority: null,
          seniorityRank: null,
        },
      ];

      const changed = reParseSeniority(roles);

      expect(changed).toBe(1);
      expect(roles[0].seniority).toBe("VP");
      expect(roles[0].seniorityRank).toBe(5);
    });

    it("should not change already-correct seniority", () => {
      const roles = [
        {
          title: "Software Engineer",
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
      ];

      const changed = reParseSeniority(roles);
      expect(changed).toBe(0);
    });

    it("should parse VP Sales as VP tier", () => {
      const roles = [
        {
          title: "VP Sales, Conversational AI",
          seniority: null,
          seniorityRank: null,
        },
      ];

      const changed = reParseSeniority(roles);

      expect(changed).toBe(1);
      expect(roles[0].seniority).toBe("VP");
      expect(roles[0].seniorityRank).toBe(5);
    });

    it("should upgrade Manager that should be Director", () => {
      const roles = [
        {
          title: "Regional Sales Manager",
          seniority: null,
          seniorityRank: null,
        },
      ];

      const changed = reParseSeniority(roles);

      expect(changed).toBe(1);
      expect(roles[0].seniority).toBe("Manager");
      expect(roles[0].seniorityRank).toBe(3);
    });

    it("should skip roles without titles", () => {
      const roles = [{ title: null, seniority: null }];
      const changed = reParseSeniority(roles);
      expect(changed).toBe(0);
    });

    it("should handle empty array", () => {
      expect(reParseSeniority([])).toBe(0);
    });
  });

  describe("computeDerivedMetrics()", () => {
    it("should compute correctly after cleanup", () => {
      const roles = [
        {
          title: "Strategic Account Executive",
          companyName: "Genesys",
          startDate: new Date("2025-01-01"),
          endDate: null,
          isCurrent: true,
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
        {
          title: "RVP Sales",
          companyName: "Verint",
          startDate: new Date("2019-12-01"),
          endDate: new Date("2021-02-01"),
          isCurrent: false,
          seniority: "VP",
          seniorityRank: 5,
        },
        {
          title: "Account Executive",
          companyName: "Verint",
          startDate: new Date("2015-03-01"),
          endDate: new Date("2019-12-01"),
          isCurrent: false,
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
      ];

      const metrics = computeDerivedMetrics(roles);

      // yearsAtCurrentCompany should be ~1 year (Genesys from Jan 2025)
      expect(metrics.yearsAtCurrentCompany).toBeGreaterThan(0.5);
      expect(metrics.yearsAtCurrentCompany).toBeLessThan(3);

      // highestSeniority should be VP from the RVP role
      expect(metrics.highestSeniority).toBe("VP");
      expect(metrics.highestSeniorityRank).toBe(5);
      expect(metrics.highestSeniorityRoleTitle).toBe("RVP Sales");

      // avgTenureMonths should be reasonable (not inflated by 2001 dates)
      expect(metrics.avgTenureMonths).toBeGreaterThan(10);
      expect(metrics.avgTenureMonths).toBeLessThan(80);
    });

    it("should return nulls for empty roles", () => {
      const metrics = computeDerivedMetrics([]);
      expect(metrics.avgTenureMonths).toBeNull();
      expect(metrics.yearsAtCurrentCompany).toBeNull();
      expect(metrics.highestSeniority).toBeNull();
    });
  });

  describe("end-to-end: mike-hare-like scenario", () => {
    it("should clean up a record with all three issues", () => {
      // Simulate the mike-hare record problems
      const roles = [
        // Real roles
        {
          title: "Strategic Account Executive",
          companyName: "Genesys",
          startDate: new Date("2025-01-01"),
          endDate: null,
          isCurrent: true,
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
        {
          title: "Strategic Account Executive",
          companyName: "Here™ (formerly OpenFin)",
          startDate: new Date("2023-04-01"),
          endDate: new Date("2025-01-01"),
          isCurrent: false,
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
        {
          title: "RVP Sales, Intelligent Self Service",
          companyName: "Verint",
          startDate: new Date("2019-12-01"),
          endDate: new Date("2021-02-01"),
          isCurrent: false,
          seniority: "Individual Contributor",
          seniorityRank: 1,
        },
        {
          title: "Regional Sales Manager",
          companyName: "Citizens Financial Group, Inc.",
          startDate: new Date("2010-01-01"),
          endDate: new Date("2014-03-01"),
          isCurrent: false,
          seniority: "Manager",
          seniorityRank: 3,
        },
        // Corrupted duplicates (2001 dates)
        {
          title: "Strategic Account Executive",
          companyName: "Genesys",
          startDate: new Date("2001-01-25"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "RVP Sales, Intelligent Self Service",
          companyName: "Verint",
          startDate: new Date("2001-12-19"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "Regional Sales Manager",
          companyName: "Citizens Financial Group, Inc.",
          startDate: new Date("2001-01-10"),
          endDate: new Date("2001-03-14"),
          isCurrent: false,
        },
        // Stale isCurrent at old company
        {
          title: "Enterprise Sales Director",
          companyName: "Five9",
          startDate: new Date("2022-02-01"),
          endDate: null,
          isCurrent: true,
        },
        {
          title: "Senior Enterprise Sales Director",
          companyName: "OpenFin",
          startDate: new Date("2023-04-01"),
          endDate: null,
          isCurrent: true,
        },
      ];

      // Step 1: Dedup corrupted dates
      const { deduped, removedCount } = deduplicateCorruptedDateRoles(roles);
      expect(removedCount).toBe(3); // 3 corrupted copies removed

      // Step 2: Fix stale isCurrent
      const flipped = fixStaleIsCurrentFlags(deduped);
      expect(flipped).toBeGreaterThanOrEqual(2); // Five9, OpenFin flipped

      // Verify only Genesys is current
      const currentRoles = deduped.filter((r) => r.isCurrent);
      expect(currentRoles).toHaveLength(1);
      expect(currentRoles[0].companyName).toBe("Genesys");

      // Step 3: Re-parse seniority
      const seniorityChanged = reParseSeniority(deduped);
      expect(seniorityChanged).toBeGreaterThanOrEqual(1); // RVP -> VP

      // Verify RVP is now VP
      const rvpRole = deduped.find((r) => r.title.includes("RVP"));
      expect(rvpRole.seniority).toBe("VP");
      expect(rvpRole.seniorityRank).toBe(5);

      // Verify derived metrics
      const metrics = computeDerivedMetrics(deduped);
      expect(metrics.yearsAtCurrentCompany).toBeLessThan(3);
      expect(metrics.highestSeniority).toBe("VP");
      expect(metrics.highestSeniorityRank).toBe(5);
      expect(metrics.avgTenureMonths).toBeLessThan(80);
    });
  });
});
