const {
  getUSRegionData,
  US_REGION_DATA,
} = require("../../src/utils/us-regions");

describe("US Regions Utility", () => {
  describe("getUSRegionData()", () => {
    // ─── Northeast — New England ───
    it.each(["CT", "ME", "MA", "NH", "RI", "VT"])(
      "should classify %s as Northeast / New England",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Northeast",
          usSubregion: "New England",
        });
        expect(result.timezone).toBe("America/New_York");
        expect(result.utcOffset).toBe(-5);
      },
    );

    // ─── Northeast — Mid-Atlantic ───
    it.each(["DE", "DC", "MD", "NJ", "NY", "PA"])(
      "should classify %s as Northeast / Mid-Atlantic",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Northeast",
          usSubregion: "Mid-Atlantic",
        });
        expect(result.timezone).toBe("America/New_York");
        expect(result.utcOffset).toBe(-5);
      },
    );

    // ─── Midwest — East North Central ───
    it.each(["IL", "IN", "MI", "OH", "WI"])(
      "should classify %s as Midwest / East North Central",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Midwest",
          usSubregion: "East North Central",
        });
      },
    );

    // ─── Midwest — West North Central ───
    it.each(["IA", "KS", "MN", "MO", "NE", "ND", "SD"])(
      "should classify %s as Midwest / West North Central",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Midwest",
          usSubregion: "West North Central",
        });
        expect(result.timezone).toBe("America/Chicago");
        expect(result.utcOffset).toBe(-6);
      },
    );

    // ─── Southeast — Lower South ───
    it.each(["AL", "FL", "GA", "MS", "SC"])(
      "should classify %s as Southeast / Lower South",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Southeast",
          usSubregion: "Lower South",
        });
      },
    );

    // ─── Southeast — Upper South ───
    it.each(["KY", "NC", "TN", "VA", "WV"])(
      "should classify %s as Southeast / Upper South",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Southeast",
          usSubregion: "Upper South",
        });
      },
    );

    // ─── Southeast — Delta ───
    it.each(["AR", "LA"])("should classify %s as Southeast / Delta", (code) => {
      const result = getUSRegionData(code);
      expect(result).toMatchObject({
        usRegion: "Southeast",
        usSubregion: "Delta",
      });
      expect(result.timezone).toBe("America/Chicago");
      expect(result.utcOffset).toBe(-6);
    });

    // ─── Southwest — Four Corners ───
    it.each(["AZ", "CO", "NM", "UT"])(
      "should classify %s as Southwest / Four Corners",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Southwest",
          usSubregion: "Four Corners",
        });
        expect(result.utcOffset).toBe(-7);
      },
    );

    // ─── Southwest — Southern Plains ───
    it.each(["OK", "TX"])(
      "should classify %s as Southwest / Southern Plains",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "Southwest",
          usSubregion: "Southern Plains",
        });
        expect(result.timezone).toBe("America/Chicago");
        expect(result.utcOffset).toBe(-6);
      },
    );

    // ─── Southwest — Great Basin ───
    it("should classify NV as Southwest / Great Basin", () => {
      const result = getUSRegionData("NV");
      expect(result).toMatchObject({
        usRegion: "Southwest",
        usSubregion: "Great Basin",
      });
      expect(result.timezone).toBe("America/Los_Angeles");
      expect(result.utcOffset).toBe(-8);
    });

    // ─── West — Pacific ───
    it.each(["AK", "CA", "HI", "OR", "WA"])(
      "should classify %s as West / Pacific",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "West",
          usSubregion: "Pacific",
        });
      },
    );

    it("should return Alaska timezone for AK", () => {
      const result = getUSRegionData("AK");
      expect(result.timezone).toBe("America/Anchorage");
      expect(result.utcOffset).toBe(-9);
    });

    it("should return Hawaii timezone for HI", () => {
      const result = getUSRegionData("HI");
      expect(result.timezone).toBe("Pacific/Honolulu");
      expect(result.utcOffset).toBe(-10);
    });

    it("should return Pacific timezone for CA", () => {
      const result = getUSRegionData("CA");
      expect(result.timezone).toBe("America/Los_Angeles");
      expect(result.utcOffset).toBe(-8);
    });

    // ─── West — Mountain ───
    it.each(["ID", "MT", "WY"])(
      "should classify %s as West / Mountain",
      (code) => {
        const result = getUSRegionData(code);
        expect(result).toMatchObject({
          usRegion: "West",
          usSubregion: "Mountain",
        });
        expect(result.utcOffset).toBe(-7);
      },
    );

    // ─── Edge cases ───
    it("should return null for null input", () => {
      expect(getUSRegionData(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(getUSRegionData(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(getUSRegionData("")).toBeNull();
    });

    it("should return null for non-US state code", () => {
      expect(getUSRegionData("ON")).toBeNull(); // Ontario
      expect(getUSRegionData("QC")).toBeNull(); // Quebec
      expect(getUSRegionData("XX")).toBeNull();
    });

    it("should handle lowercase state codes", () => {
      const result = getUSRegionData("ca");
      expect(result).toMatchObject({
        usRegion: "West",
        usSubregion: "Pacific",
      });
    });

    it("should handle mixed-case state codes", () => {
      const result = getUSRegionData("Ny");
      expect(result).toMatchObject({
        usRegion: "Northeast",
        usSubregion: "Mid-Atlantic",
      });
    });

    it("should return null for non-string input", () => {
      expect(getUSRegionData(123)).toBeNull();
      expect(getUSRegionData({})).toBeNull();
    });
  });

  describe("US_REGION_DATA completeness", () => {
    it("should cover all 50 states plus DC (51 entries)", () => {
      expect(Object.keys(US_REGION_DATA)).toHaveLength(51);
    });

    it("should have all required fields for every entry", () => {
      for (const [_code, data] of Object.entries(US_REGION_DATA)) {
        expect(data).toHaveProperty("usRegion");
        expect(data).toHaveProperty("usSubregion");
        expect(data).toHaveProperty("timezone");
        expect(data).toHaveProperty("utcOffset");
        expect(typeof data.usRegion).toBe("string");
        expect(typeof data.usSubregion).toBe("string");
        expect(typeof data.timezone).toBe("string");
        expect(typeof data.utcOffset).toBe("number");
        // utcOffset must be between -12 and 14
        expect(data.utcOffset).toBeGreaterThanOrEqual(-12);
        expect(data.utcOffset).toBeLessThanOrEqual(14);
      }
    });

    it("should only contain valid region names", () => {
      const validRegions = [
        "Northeast",
        "Midwest",
        "Southeast",
        "Southwest",
        "West",
      ];
      for (const data of Object.values(US_REGION_DATA)) {
        expect(validRegions).toContain(data.usRegion);
      }
    });

    it("should only contain valid subregion names", () => {
      const validSubregions = [
        "New England",
        "Mid-Atlantic",
        "East North Central",
        "West North Central",
        "Lower South",
        "Upper South",
        "Delta",
        "Four Corners",
        "Southern Plains",
        "Great Basin",
        "Pacific",
        "Mountain",
      ];
      for (const data of Object.values(US_REGION_DATA)) {
        expect(validSubregions).toContain(data.usSubregion);
      }
    });
  });
});
