const {
  extractPublicProfileUrl,
  extractCompanyId,
  resolvePersonIdentity,
  resolveCompanyIdentity,
  resolveLocationIdentity,
} = require("../utils/identityMatcher");

describe("Identity Resolution Utility", () => {
  describe("extractPublicProfileUrl()", () => {
    it("should extract and normalize public profile username", () => {
      const url = "https://www.linkedin.com/in/johndoe/";
      const result = extractPublicProfileUrl(url);

      expect(result).toBe("linkedin.com/in/johndoe");
    });

    it("should handle URLs without trailing slash", () => {
      const url = "https://linkedin.com/in/janedoe";
      const result = extractPublicProfileUrl(url);

      expect(result).toBe("linkedin.com/in/janedoe");
    });

    it("should handle /pub/ URLs", () => {
      const url = "https://www.linkedin.com/pub/john-smith";
      const result = extractPublicProfileUrl(url);

      expect(result).toBe("linkedin.com/pub/john-smith");
    });

    it("should return null for Sales Navigator URLs", () => {
      const url = "https://www.linkedin.com/sales/lead/ACwAAABCDEF";
      const result = extractPublicProfileUrl(url);

      expect(result).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(extractPublicProfileUrl(null)).toBeNull();
      expect(extractPublicProfileUrl("")).toBeNull();
    });
  });

  describe("extractCompanyId()", () => {
    it("should extract numeric company ID", () => {
      const companyId = "12345678";
      const result = extractCompanyId(companyId);

      expect(result).toBe("12345678");
    });

    it("should return null for non-numeric company ID", () => {
      const companyId = "TechCorp";
      const result = extractCompanyId(companyId);

      expect(result).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(extractCompanyId(null)).toBeNull();
      expect(extractCompanyId("")).toBeNull();
    });
  });

  describe("resolvePersonIdentity()", () => {
    it("should use Sales Nav ID as primary identity (most stable)", () => {
      // Sales Nav ID is most stable - never changes even if profile is updated
      // LinkedIn username is collected as alias for cross-platform matching
      const webhookData = {
        SalesProfile:
          "https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME_SEARCH,vVb7",
        Profile: "https://www.linkedin.com/in/johndoe",
        PublicProfile: "https://www.linkedin.com/in/johndoe",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe("ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ"); // Sales Nav ID
      expect(result.source).toBe("salesNavId");
      expect(result.aliases).toContainEqual({
        type: "linkedInUsername",
        value: "johndoe",
      });
      expect(result.aliases).toContainEqual({
        type: "salesNavId",
        value: "ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ",
      });
    });

    it("should use Sales Nav ID when LinkedIn username not available", () => {
      // Sales Nav ID is Priority 2 (when no username exists)
      const webhookData = {
        SalesProfile:
          "https://www.linkedin.com/sales/lead/ACwAAABCDEFGHIJ,NAME_SEARCH,xyz",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe("ACwAAABCDEFGHIJ");
      expect(result.source).toBe("salesNavId");
    });

    it("should extract Sales Nav ID from RecruiterProfile when available", () => {
      // RecruiterProfile contains Sales Nav ID - used as primary identity
      // LinkedIn username from Profile is collected as alias
      const webhookData = {
        RecruiterProfile:
          "https://www.linkedin.com/talent/profile/ACwAAABCDEFGHIJ",
        Profile: "https://www.linkedin.com/in/janedoe",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe("ACwAAABCDEFGHIJ"); // Sales Nav ID from RecruiterProfile
      expect(result.source).toBe("salesNavId");
      expect(result.aliases).toContainEqual({
        type: "linkedInUsername",
        value: "janedoe",
      });
    });

    it("should fallback to normalized profile URL when no username/Sales Nav ID", () => {
      // Normalized URL is Priority 3
      const webhookData = {
        Profile: "https://www.linkedin.com/profile/87654321",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe("linkedin.com/profile/87654321");
      expect(result.source).toBe("profileUrl");
    });

    it("should extract username from profile URL", () => {
      // LinkedIn username extraction from /in/ URL
      const webhookData = {
        Profile: "https://www.linkedin.com/in/johndoe",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe("johndoe"); // Extracted username
      expect(result.source).toBe("linkedInUsername");
    });

    it("should collect all aliases from multiple profile fields", () => {
      const webhookData = {
        SalesProfile:
          "https://www.linkedin.com/sales/lead/ACwAAALwVAIBAlYW8bgTnsx7olXcSj4WBeNZygQ,NAME_SEARCH,vVb7",
        Profile: "https://www.linkedin.com/in/johndoe",
        PublicProfile: "https://www.linkedin.com/in/john-doe",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.aliases.length).toBeGreaterThanOrEqual(3);
      expect(result.aliases).toContainEqual(
        expect.objectContaining({ type: "salesNavId" }),
      );
      expect(result.aliases).toContainEqual(
        expect.objectContaining({ type: "linkedInUsername", value: "johndoe" }),
      );
    });

    it("should add numericId alias when duxsoup ID is numeric", () => {
      const webhookData = {
        id: "id.218248067",
        Profile: "https://www.linkedin.com/profile/218248067",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.aliases).toContainEqual({
        type: "numericId",
        value: "218248067",
      });
    });

    it("should compute canonical_id for sales nav identity", () => {
      const webhookData = {
        SalesProfile: "https://www.linkedin.com/sales/lead/ACwAAA_TEST123",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.canonical_id).toBeTruthy();
      expect(result.canonical_key).toBe("salesNavId:ACwAAA_TEST123");
      expect(result.primary_id_type).toBe("salesNavId");
    });

    it("should compute same canonical_id across equivalent sales nav sources", () => {
      const bySalesProfile = resolvePersonIdentity({
        SalesProfile: "https://www.linkedin.com/sales/lead/ACwAAA_SHARED",
      });

      const byProfile = resolvePersonIdentity({
        Profile: "https://www.linkedin.com/sales/lead/ACwAAA_SHARED",
      });

      expect(bySalesProfile.canonical_id).toBe(byProfile.canonical_id);
      expect(bySalesProfile.canonical_key).toBe("salesNavId:ACwAAA_SHARED");
      expect(byProfile.canonical_key).toBe("salesNavId:ACwAAA_SHARED");
    });

    it("should return null person_id when no identifiers present", () => {
      const webhookData = {
        "First Name": "John",
        "Last Name": "Doe",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBeNull();
      expect(result.source).toBeNull();
      expect(result.aliases).toEqual([]);
    });
  });

  describe("resolveCompanyIdentity()", () => {
    it("should use numeric CompanyID as primary identity", () => {
      const webhookData = {
        CompanyID: "12345678",
        Company: "TechCorp",
        CompanyProfile: "https://www.linkedin.com/company/techcorp",
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.company_id).toBe("12345678");
      expect(result.source).toBe("numericId");
      expect(result.canonical_id).toBeTruthy();
      expect(result.canonical_key).toBe("numericId:12345678");
      expect(result.aliases).toContainEqual({
        type: "numericId",
        value: "12345678",
      });
    });

    it("should NOT create company with only name (requires numeric ID)", () => {
      const webhookData = {
        Company: "TechCorp",
      };

      const result = resolveCompanyIdentity(webhookData);

      // Company name alone is insufficient - numeric ID required
      expect(result.company_id).toBeNull();
      expect(result.source).toBeNull();
      expect(result.canonical_id).toBeNull();

      // But name is still captured as alias for when numeric ID is found later
      expect(result.aliases).toContainEqual({
        type: "name",
        value: "TechCorp",
      });
    });

    it("should include company profile URL as alias", () => {
      const webhookData = {
        CompanyID: "12345678",
        Company: "TechCorp",
        CompanyProfile: "https://www.linkedin.com/company/techcorp",
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.aliases).toContainEqual({
        type: "profileUrl",
        value: "linkedin.com/company/techcorp",
      });
    });

    it("should return null company_id when no identifiers present", () => {
      const webhookData = {
        "First Name": "John",
      };

      const result = resolveCompanyIdentity(webhookData);

      expect(result.company_id).toBeNull();
      expect(result.source).toBeNull();
    });
  });

  describe("resolveLocationIdentity()", () => {
    it("should normalize and compute canonical_id for location", () => {
      const result = resolveLocationIdentity("Greater Indianapolis, IN");

      expect(result.location_id).toBe("greater-indianapolis-in");
      expect(result.canonical_id).toBeTruthy();
      expect(result.canonical_key).toBe("location:greater-indianapolis-in");
      expect(result.aliases).toContainEqual(
        expect.objectContaining({
          type: "normalized",
          value: "Greater Indianapolis, IN",
        }),
      );
    });

    it("should return null identifiers for empty input", () => {
      const result = resolveLocationIdentity("   ");

      expect(result.location_id).toBeNull();
      expect(result.canonical_id).toBeNull();
    });
  });
});
