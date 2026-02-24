const { normalizeCompanyName } = require("../../src/utils/companyNormalizer");

describe("normalizeCompanyName", () => {
  describe("null/empty/invalid inputs", () => {
    it("should return null for null", () => {
      expect(normalizeCompanyName(null)).toBeNull();
    });

    it("should return null for undefined", () => {
      expect(normalizeCompanyName(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(normalizeCompanyName("")).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      expect(normalizeCompanyName("   ")).toBeNull();
    });

    it("should return null for non-string (number)", () => {
      expect(normalizeCompanyName(123)).toBeNull();
    });

    it("should return null for non-string (object)", () => {
      expect(normalizeCompanyName({ text: "Acme" })).toBeNull();
    });

    it("should return null for non-string (boolean)", () => {
      expect(normalizeCompanyName(true)).toBeNull();
    });
  });

  describe("whitespace trimming and collapsing", () => {
    it("should trim leading whitespace", () => {
      expect(normalizeCompanyName("  Microsoft")).toBe("Microsoft");
    });

    it("should trim trailing whitespace", () => {
      expect(normalizeCompanyName("Microsoft  ")).toBe("Microsoft");
    });

    it("should collapse internal whitespace", () => {
      expect(normalizeCompanyName("J.P.   Morgan")).toBe("J.P. Morgan");
    });

    it("should trim and collapse together", () => {
      expect(normalizeCompanyName("  Some   Company  ")).toBe("Some Company");
    });
  });

  describe("suffix stripping — English long-form", () => {
    it("should strip 'Corporation'", () => {
      expect(normalizeCompanyName("Microsoft Corporation")).toBe("Microsoft");
    });

    it("should strip 'Incorporated'", () => {
      expect(normalizeCompanyName("Acme Incorporated")).toBe("Acme");
    });

    it("should strip 'Limited'", () => {
      expect(normalizeCompanyName("HSBC Limited")).toBe("HSBC");
    });

    it("should strip 'Limited Liability Company'", () => {
      expect(normalizeCompanyName("Acme Limited Liability Company")).toBe(
        "Acme",
      );
    });

    it("should strip 'Limited Partnership'", () => {
      expect(normalizeCompanyName("Fund Limited Partnership")).toBe("Fund");
    });
  });

  describe("suffix stripping — abbreviated English", () => {
    it("should strip 'Corp.'", () => {
      expect(normalizeCompanyName("Microsoft Corp.")).toBe("Microsoft");
    });

    it("should strip 'Inc.'", () => {
      expect(normalizeCompanyName("Apple Inc.")).toBe("Apple");
    });

    it("should strip 'LLC'", () => {
      expect(normalizeCompanyName("Acme LLC")).toBe("Acme");
    });

    it("should strip 'L.L.C.'", () => {
      expect(normalizeCompanyName("Acme L.L.C.")).toBe("Acme");
    });

    it("should strip 'LP'", () => {
      expect(normalizeCompanyName("Fund LP")).toBe("Fund");
    });

    it("should strip 'L.P.'", () => {
      expect(normalizeCompanyName("Fund L.P.")).toBe("Fund");
    });

    it("should strip 'Ltd.'", () => {
      expect(normalizeCompanyName("Barclays Ltd.")).toBe("Barclays");
    });

    it("should strip 'Co.'", () => {
      expect(normalizeCompanyName("Tiffany Co.")).toBe("Tiffany");
    });
  });

  describe("suffix stripping — international", () => {
    it("should strip 'PLC'", () => {
      expect(normalizeCompanyName("BP PLC")).toBe("BP");
    });

    it("should strip 'P.L.C.'", () => {
      expect(normalizeCompanyName("BP P.L.C.")).toBe("BP");
    });

    it("should strip 'GmbH'", () => {
      expect(normalizeCompanyName("Siemens GmbH")).toBe("Siemens");
    });

    it("should strip 'AG'", () => {
      expect(normalizeCompanyName("Deutsche Bank AG")).toBe("Deutsche Bank");
    });

    it("should strip 'S.A.'", () => {
      expect(normalizeCompanyName("Petrobras S.A.")).toBe("Petrobras");
    });

    it("should strip 'SA'", () => {
      expect(normalizeCompanyName("Petrobras SA")).toBe("Petrobras");
    });

    it("should strip 'S.r.l.'", () => {
      expect(normalizeCompanyName("Luxottica S.r.l.")).toBe("Luxottica");
    });

    it("should strip 'SRL'", () => {
      expect(normalizeCompanyName("Luxottica SRL")).toBe("Luxottica");
    });

    it("should strip 'B.V.'", () => {
      expect(normalizeCompanyName("Philips B.V.")).toBe("Philips");
    });

    it("should strip 'BV'", () => {
      expect(normalizeCompanyName("Philips BV")).toBe("Philips");
    });

    it("should strip 'N.V.'", () => {
      expect(normalizeCompanyName("ING N.V.")).toBe("ING");
    });

    it("should strip 'NV'", () => {
      expect(normalizeCompanyName("ING NV")).toBe("ING");
    });

    it("should strip 'Pty.'", () => {
      expect(normalizeCompanyName("Atlassian Pty.")).toBe("Atlassian");
    });

    it("should strip 'Pvt.'", () => {
      expect(normalizeCompanyName("Infosys Pvt.")).toBe("Infosys");
    });
  });

  describe("case-insensitive suffix matching", () => {
    it("should strip 'inc.' (lowercase)", () => {
      expect(normalizeCompanyName("Apple inc.")).toBe("Apple");
    });

    it("should strip 'INC.' (uppercase)", () => {
      expect(normalizeCompanyName("Apple INC.")).toBe("Apple");
    });

    it("should strip 'Corporation' (mixed case)", () => {
      expect(normalizeCompanyName("Microsoft CORPORATION")).toBe("Microsoft");
    });

    it("should strip 'llc' (lowercase)", () => {
      expect(normalizeCompanyName("Acme llc")).toBe("Acme");
    });
  });

  describe("comma-separated suffixes", () => {
    it("should strip ', Inc.'", () => {
      expect(normalizeCompanyName("Acme, Inc.")).toBe("Acme");
    });

    it("should strip ', LLC'", () => {
      expect(normalizeCompanyName("Acme, LLC")).toBe("Acme");
    });

    it("should strip ', Ltd.'", () => {
      expect(normalizeCompanyName("Acme, Ltd.")).toBe("Acme");
    });
  });

  describe("original casing preserved", () => {
    it("should preserve title case", () => {
      expect(normalizeCompanyName("Goldman Sachs Inc.")).toBe("Goldman Sachs");
    });

    it("should preserve uppercase", () => {
      expect(normalizeCompanyName("IBM Corporation")).toBe("IBM");
    });

    it("should preserve mixed case", () => {
      expect(normalizeCompanyName("eBay Inc.")).toBe("eBay");
    });
  });

  describe("embedded suffixes NOT stripped (safety)", () => {
    it("should NOT strip 'Inc' from 'Incredible Machines'", () => {
      expect(normalizeCompanyName("Incredible Machines")).toBe(
        "Incredible Machines",
      );
    });

    it("should NOT strip 'Co' from 'Cooper Industries'", () => {
      expect(normalizeCompanyName("Cooper Industries")).toBe(
        "Cooper Industries",
      );
    });

    it("should NOT strip 'AG' from 'AGILE Solutions'", () => {
      expect(normalizeCompanyName("AGILE Solutions")).toBe("AGILE Solutions");
    });

    it("should NOT strip from 'Limited Edition Studios'", () => {
      expect(normalizeCompanyName("Limited Edition Studios")).toBe(
        "Limited Edition Studios",
      );
    });
  });

  describe("edge cases", () => {
    it("should return null when suffix-only input", () => {
      expect(normalizeCompanyName("Inc.")).toBeNull();
    });

    it("should return null when comma + suffix only", () => {
      expect(normalizeCompanyName(", LLC")).toBeNull();
    });

    it("should handle '& Co.' pattern", () => {
      expect(normalizeCompanyName("J.P. Morgan & Co.")).toBe("J.P. Morgan");
    });

    it("should handle no suffix — pass through unchanged", () => {
      expect(normalizeCompanyName("Deloitte")).toBe("Deloitte");
    });

    it("should handle single word with suffix", () => {
      expect(normalizeCompanyName("Alphabet Inc.")).toBe("Alphabet");
    });
  });

  describe("real-world company names", () => {
    it("should normalize 'Microsoft Corporation'", () => {
      expect(normalizeCompanyName("Microsoft Corporation")).toBe("Microsoft");
    });

    it("should normalize '  Microsoft  Corporation '", () => {
      expect(normalizeCompanyName("  Microsoft  Corporation ")).toBe(
        "Microsoft",
      );
    });

    it("should normalize 'Apple Inc.'", () => {
      expect(normalizeCompanyName("Apple Inc.")).toBe("Apple");
    });

    it("should normalize 'Goldman Sachs & Co. LLC'", () => {
      expect(normalizeCompanyName("Goldman Sachs & Co. LLC")).toBe(
        "Goldman Sachs & Co.",
      );
    });

    it("should normalize 'Berkshire Hathaway Inc.'", () => {
      expect(normalizeCompanyName("Berkshire Hathaway Inc.")).toBe(
        "Berkshire Hathaway",
      );
    });

    it("should normalize 'Deutsche Bank AG'", () => {
      expect(normalizeCompanyName("Deutsche Bank AG")).toBe("Deutsche Bank");
    });

    it("should normalize 'Siemens AG'", () => {
      expect(normalizeCompanyName("Siemens AG")).toBe("Siemens");
    });
  });
});
