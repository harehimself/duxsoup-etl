const {
  parseLocation,
  batchParseLocations,
} = require("../../src/utils/location-parser");

describe("Location Parser Utility", () => {
  describe("parseLocation()", () => {
    describe("Metropolitan Areas", () => {
      it("should parse Los Angeles Metropolitan Area with city, state, country", () => {
        const result = parseLocation("Los Angeles Metropolitan Area");

        expect(result).toMatchObject({
          rawLocation: "Los Angeles Metropolitan Area",
          city: "Los Angeles",
          state: "California",
          stateCode: "CA",
          country: "United States",
          countryCode: "US",
          region: "Los Angeles",
          locationType: "metropolitan",
        });
      });

      it("should parse Greater Tampa Bay Area with inferred state", () => {
        const result = parseLocation("Greater Tampa Bay Area");

        expect(result).toMatchObject({
          rawLocation: "Greater Tampa Bay Area",
          city: "Tampa Bay",
          state: "Florida",
          stateCode: "FL",
          country: "United States",
          countryCode: "US",
          region: "Tampa Bay",
          locationType: "metropolitan",
        });
      });

      it("should parse Chicago Metro Area with inferred state", () => {
        const result = parseLocation("Chicago Metro Area");

        expect(result).toMatchObject({
          city: "Chicago",
          state: "Illinois",
          stateCode: "IL",
          country: "United States",
          countryCode: "US",
          region: "Chicago",
          locationType: "metropolitan",
        });
      });

      it("should parse San Francisco Bay Area with inferred state", () => {
        const result = parseLocation("San Francisco Bay Area");

        expect(result).toMatchObject({
          city: "San Francisco",
          state: "California",
          stateCode: "CA",
          country: "United States",
          countryCode: "US",
          region: "San Francisco",
          locationType: "metropolitan",
        });
      });

      it("should parse Denver Metropolitan Area with inferred state", () => {
        const result = parseLocation("Denver Metropolitan Area");

        expect(result).toMatchObject({
          city: "Denver",
          state: "Colorado",
          stateCode: "CO",
          country: "United States",
          countryCode: "US",
          region: "Denver",
          locationType: "metropolitan",
        });
      });

      it("should handle metro area without recognized city", () => {
        const result = parseLocation("Unknown City Metropolitan Area");

        expect(result).toMatchObject({
          rawLocation: "Unknown City Metropolitan Area",
          city: "Unknown City",
          state: null,
          stateCode: null,
          country: null,
          countryCode: null,
          region: "Unknown City",
          locationType: "metropolitan",
        });
      });
    });

    describe("Standard City, State, Country Format", () => {
      it("should parse City, State, Country (three parts)", () => {
        const result = parseLocation("Chicago, Illinois, United States");

        expect(result).toMatchObject({
          city: "Chicago",
          state: "Illinois",
          stateCode: "IL",
          country: "United States",
          countryCode: "US",
          locationType: "city",
        });
      });

      it("should parse City, State Code (two parts)", () => {
        const result = parseLocation("San Francisco, CA");

        expect(result).toMatchObject({
          city: "San Francisco",
          state: "California",
          stateCode: "CA",
          country: "United States",
          countryCode: "US",
          locationType: "city",
        });
      });

      it("should parse City, State Full Name (two parts)", () => {
        const result = parseLocation("Austin, Texas");

        expect(result).toMatchObject({
          city: "Austin",
          state: "Texas",
          stateCode: "TX",
          country: "United States",
          countryCode: "US",
          locationType: "city",
        });
      });

      it("should parse City, Country (non-US)", () => {
        const result = parseLocation("Toronto, Canada");

        expect(result).toMatchObject({
          city: "Toronto",
          country: "Canada",
          countryCode: "CA",
          state: null,
          stateCode: null,
          locationType: "city",
        });
      });

      it("should parse City, Province, Country (Canada)", () => {
        const result = parseLocation("Toronto, Ontario, Canada");

        expect(result).toMatchObject({
          city: "Toronto",
          province: "Ontario",
          country: "Canada",
          countryCode: "CA",
          locationType: "city",
        });
      });

      it("should parse City, Region, Country (UK)", () => {
        const result = parseLocation("London, England, United Kingdom");

        expect(result).toMatchObject({
          city: "London",
          province: "England",
          country: "United Kingdom",
          countryCode: "GB",
          locationType: "city",
        });
      });
    });

    describe("Edge Cases", () => {
      it("should handle single word location", () => {
        const result = parseLocation("Chicago");

        expect(result).toMatchObject({
          city: "Chicago",
          locationType: "city",
        });
      });

      it("should handle null input", () => {
        const result = parseLocation(null);

        expect(result).toMatchObject({
          rawLocation: "",
          locationType: "unknown",
        });
      });

      it("should handle empty string", () => {
        const result = parseLocation("");

        expect(result).toMatchObject({
          rawLocation: "",
          locationType: "unknown",
        });
      });

      it("should handle non-string input", () => {
        const result = parseLocation(12345);

        expect(result).toMatchObject({
          rawLocation: 12345,
          locationType: "unknown",
        });
      });

      it("should handle four+ part locations", () => {
        const result = parseLocation("City, District, Province, Country");

        expect(result).toMatchObject({
          city: "City",
          province: "District",
          country: "Country",
          locationType: "city",
        });
      });
    });
  });

  describe("batchParseLocations()", () => {
    it("should parse multiple locations", () => {
      const locations = [
        "Los Angeles Metropolitan Area",
        "Chicago, IL",
        "Toronto, Ontario, Canada",
      ];

      const results = batchParseLocations(locations);

      expect(results).toHaveLength(3);
      expect(results[0].city).toBe("Los Angeles");
      expect(results[1].city).toBe("Chicago");
      expect(results[2].city).toBe("Toronto");
    });

    it("should handle empty array", () => {
      const results = batchParseLocations([]);

      expect(results).toEqual([]);
    });
  });
});
