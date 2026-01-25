const {
  extractLinkedInUsername,
  extractSalesNavId,
  extractIdentifiers,
  getPrimaryIdentifier,
  generateIdentityKey,
  isSamePerson,
} = require("../../src/utils/identityMatcher");

describe("Identity Matcher Utility", () => {
  describe("extractLinkedInUsername", () => {
    it("should extract username from regular LinkedIn profile URL", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/bret-lamb-1424546/",
      };
      expect(extractLinkedInUsername(data)).toBe("bret-lamb-1424546");
    });

    it("should extract username from pid DuxSoup ID", () => {
      const data = {
        id: "pid.bret-lamb-1424546",
      };
      expect(extractLinkedInUsername(data)).toBe("bret-lamb-1424546");
    });

    it("should NOT extract Sales Nav ID as username", () => {
      const data = {
        PublicProfile:
          "https://www.linkedin.com/in/ACwAAA-2MOoBXZfmEDcFdHRMMnJQrrRbIGN2ALI",
      };
      expect(extractLinkedInUsername(data)).toBeNull();
    });

    it("should extract from PublicProfile field", () => {
      const data = {
        PublicProfile: "https://www.linkedin.com/in/john-doe-12345/",
      };
      expect(extractLinkedInUsername(data)).toBe("john-doe-12345");
    });

    it("should return null if no username found", () => {
      const data = {
        Profile: "https://www.linkedin.com/sales/lead/ACwAAA123",
      };
      expect(extractLinkedInUsername(data)).toBeNull();
    });

    it("should be case-insensitive", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/John-Doe/",
      };
      expect(extractLinkedInUsername(data)).toBe("john-doe");
    });
  });

  describe("extractSalesNavId", () => {
    it("should extract Sales Nav ID from SalesProfile", () => {
      const data = {
        SalesProfile:
          "https://www.linkedin.com/sales/lead/ACwAAAEiQMIBVrfkvaejRy13OSJVdwNFNpiVw5o,NAME_SEARCH,Jvd7",
      };
      expect(extractSalesNavId(data)).toBe(
        "ACwAAAEiQMIBVrfkvaejRy13OSJVdwNFNpiVw5o",
      );
    });

    it("should extract Sales Nav ID from PublicProfile", () => {
      const data = {
        PublicProfile:
          "https://www.linkedin.com/in/ACwAAA-2MOoBXZfmEDcFdHRMMnJQrrRbIGN2ALI",
      };
      expect(extractSalesNavId(data)).toBe(
        "ACwAAA-2MOoBXZfmEDcFdHRMMnJQrrRbIGN2ALI",
      );
    });

    it("should handle ACoAAA pattern (alternative Sales Nav format)", () => {
      const data = {
        SalesProfile: "https://www.linkedin.com/sales/lead/ACoAAABCDEF-123_xyz",
      };
      expect(extractSalesNavId(data)).toBe("ACoAAABCDEF-123_xyz");
    });

    it("should return null if no Sales Nav ID found", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };
      expect(extractSalesNavId(data)).toBeNull();
    });
  });

  describe("extractIdentifiers", () => {
    it("should extract all available identifiers", () => {
      const data = {
        id: "pid.john-doe",
        Profile: "https://www.linkedin.com/in/john-doe/",
        SalesProfile:
          "https://www.linkedin.com/sales/lead/ACwAAA123,NAME_SEARCH,xyz",
      };

      const identifiers = extractIdentifiers(data);

      expect(identifiers.linkedInUsername).toBe("john-doe");
      expect(identifiers.salesNavId).toBe("ACwAAA123");
      expect(identifiers.duxsoupId).toBe("pid.john-doe");
      expect(identifiers.profileUrl).toBe("www.linkedin.com/in/john-doe");
    });

    it("should handle webhook data structure (nested data field)", () => {
      const webhookData = {
        data: {
          Profile: "https://www.linkedin.com/in/jane-smith/",
          id: "id.12345",
        },
      };

      const identifiers = extractIdentifiers(webhookData);

      expect(identifiers.linkedInUsername).toBe("jane-smith");
      expect(identifiers.duxsoupId).toBe("id.12345");
    });
  });

  describe("getPrimaryIdentifier", () => {
    it("should prioritize Sales Nav ID over LinkedIn username", () => {
      const identifiers = {
        linkedInUsername: "john-doe",
        salesNavId: "ACwAAA123",
        duxsoupId: "id.456",
      };

      const primary = getPrimaryIdentifier(identifiers);

      expect(primary.type).toBe("salesNavId");
      expect(primary.value).toBe("ACwAAA123");
    });

    it("should use Sales Nav ID if username not available", () => {
      const identifiers = {
        linkedInUsername: null,
        salesNavId: "ACwAAA123",
        duxsoupId: "id.456",
      };

      const primary = getPrimaryIdentifier(identifiers);

      expect(primary.type).toBe("salesNavId");
      expect(primary.value).toBe("ACwAAA123");
    });

    it("should fall back to DuxSoup ID as last resort", () => {
      const identifiers = {
        linkedInUsername: null,
        salesNavId: null,
        profileUrl: null,
        publicProfile: null,
        recruiterProfile: null,
        duxsoupId: "id.456",
      };

      const primary = getPrimaryIdentifier(identifiers);

      expect(primary.type).toBe("duxsoupId");
      expect(primary.value).toBe("id.456");
    });

    it("should return null if no identifiers available", () => {
      const identifiers = {
        linkedInUsername: null,
        salesNavId: null,
        duxsoupId: null,
        profileUrl: null,
        publicProfile: null,
        recruiterProfile: null,
      };

      const primary = getPrimaryIdentifier(identifiers);

      expect(primary).toBeNull();
    });
  });

  describe("generateIdentityKey", () => {
    it("should generate consistent key for same identifier", () => {
      const data1 = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };
      const data2 = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };

      const key1 = generateIdentityKey(data1);
      const key2 = generateIdentityKey(data2);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA256 hash length
    });

    it("should generate different keys for different identifiers", () => {
      const data1 = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };
      const data2 = {
        Profile: "https://www.linkedin.com/in/jane-smith/",
      };

      const key1 = generateIdentityKey(data1);
      const key2 = generateIdentityKey(data2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("isSamePerson", () => {
    it("should return true if LinkedIn usernames match", () => {
      const data1 = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };
      const data2 = {
        id: "pid.john-doe",
      };

      expect(isSamePerson(data1, data2)).toBe(true);
    });

    it("should return true if Sales Nav IDs match", () => {
      const data1 = {
        SalesProfile: "https://www.linkedin.com/sales/lead/ACwAAA123",
      };
      const data2 = {
        PublicProfile: "https://www.linkedin.com/in/ACwAAA123",
      };

      expect(isSamePerson(data1, data2)).toBe(true);
    });

    it("should return false if no identifiers match", () => {
      const data1 = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };
      const data2 = {
        Profile: "https://www.linkedin.com/in/jane-smith/",
      };

      expect(isSamePerson(data1, data2)).toBe(false);
    });

    it("should handle real-world Bret Lamb scenario", () => {
      // Sales Nav scan
      const scan1 = {
        id: "id.19022018",
        Profile:
          "https://www.linkedin.com/sales/lead/ACwAAAEiQMIBVrfkvaejRy13OSJVdwNFNpiVw5o,NAME_SEARCH,Jvd7",
        SalesProfile:
          "https://www.linkedin.com/sales/lead/ACwAAAEiQMIBVrfkvaejRy13OSJVdwNFNpiVw5o,NAME_SEARCH,Jvd7",
      };

      // Regular LinkedIn scan
      const scan2 = {
        id: "pid.bret-lamb-1424546",
        Profile: "https://www.linkedin.com/in/bret-lamb-1424546/",
      };

      // These should NOT match (no shared identifier)
      // This is a known limitation - would need graph matching
      expect(isSamePerson(scan1, scan2)).toBe(false);
    });
  });
});
