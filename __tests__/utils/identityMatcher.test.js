const {
  extractLinkedInUsername,
  extractVanityName,
  extractSalesNavId,
  normalizeUrl,
  normalizeDuxsoupId,
  extractIdentifiers,
  getPrimaryIdentifier,
  generateIdentityKey,
  isSamePerson,
  safeDecode,
  resolvePersonIdentity,
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

  describe("extractVanityName", () => {
    it("should extract vanity name from Profile URL", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/mike-hare/",
      };
      expect(extractVanityName(data)).toBe("mike-hare");
    });

    it("should extract vanity name from PublicProfile URL", () => {
      const data = {
        PublicProfile: "https://www.linkedin.com/in/john-doe-12345/",
      };
      expect(extractVanityName(data)).toBe("john-doe-12345");
    });

    it("should NOT extract Sales Nav ID as vanity name", () => {
      const data = {
        Profile:
          "https://www.linkedin.com/in/ACoAAABE0YMBV0hB3H25XkLdge6Z26NdlwNqCyQ",
      };
      expect(extractVanityName(data)).toBeNull();
    });

    it("should NOT extract from Sales Navigator URLs (no /in/ path)", () => {
      const data = {
        Profile:
          "https://www.linkedin.com/sales/lead/ACwAAAEiQMIBVrfkvaejRy13OSJVdwNFNpiVw5o",
      };
      expect(extractVanityName(data)).toBeNull();
    });

    it("should NOT extract from pid DuxSoup IDs (URL-only source)", () => {
      const data = {
        id: "pid.mike-hare",
      };
      expect(extractVanityName(data)).toBeNull();
    });

    it("should be case-insensitive and lowercase the result", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/Mike-Hare/",
      };
      expect(extractVanityName(data)).toBe("mike-hare");
    });

    it("should prefer Profile over PublicProfile", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/profile-name/",
        PublicProfile: "https://www.linkedin.com/in/public-name/",
      };
      expect(extractVanityName(data)).toBe("profile-name");
    });

    it("should return null if no /in/ URL is present", () => {
      const data = {
        id: "id.12345",
      };
      expect(extractVanityName(data)).toBeNull();
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
      expect(identifiers.vanityName).toBe("john-doe");
      expect(identifiers.salesNavId).toBe("ACwAAA123");
      expect(identifiers.duxsoupId).toBe("pid.john-doe");
      expect(identifiers.profileUrl).toBe("linkedin.com/in/john-doe");
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

  describe("normalizeUrl — Item 16 robustness", () => {
    it("should strip comma-separated tracking params from Sales Nav URLs", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/sales/lead/ACwAAALwVAIB,NAME,o7fk",
      );
      expect(result).toBe("linkedin.com/sales/lead/acwaaalwvaib");
    });

    it("should strip query parameters", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/in/john-doe?trk=search",
      );
      expect(result).toBe("linkedin.com/in/john-doe");
    });

    it("should strip both query and comma params", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/sales/lead/ACwAAA123?trk=foo,NAME,bar",
      );
      // Query params stripped first, then comma params
      expect(result).toBe("linkedin.com/sales/lead/acwaaa123");
    });

    it("should normalize double slashes", () => {
      const result = normalizeUrl("https://www.linkedin.com/in//mike-hare//");
      expect(result).toBe("linkedin.com/in/mike-hare");
    });

    it("should normalize trailing slashes", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/mike-hare/");
      expect(result).toBe("linkedin.com/in/mike-hare");
    });

    it("should handle multiple double slashes", () => {
      const result = normalizeUrl("https://www.linkedin.com//in///mike-hare");
      expect(result).toBe("linkedin.com/in/mike-hare");
    });

    it("should remove www subdomain", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/john-doe");
      expect(result).toBe("linkedin.com/in/john-doe");
    });

    it("should handle http protocol", () => {
      const result = normalizeUrl("http://linkedin.com/in/john-doe");
      expect(result).toBe("linkedin.com/in/john-doe");
    });

    it("should return null for null/undefined input", () => {
      expect(normalizeUrl(null)).toBeNull();
      expect(normalizeUrl(undefined)).toBeNull();
    });

    it("should lowercase the result", () => {
      const result = normalizeUrl("https://www.LinkedIn.com/in/John-Doe/");
      expect(result).toBe("linkedin.com/in/john-doe");
    });

    it("should handle Sales Nav URL with NAME_SEARCH params", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/sales/lead/ACwAAAEiQMIB,NAME_SEARCH,Z1JY",
      );
      expect(result).toBe("linkedin.com/sales/lead/acwaaaeiqmib");
    });
  });

  describe("normalizeUrl — URL validation guard", () => {
    it("should return null for Sales Navigator ID (not a URL)", () => {
      expect(normalizeUrl("ACwAAA_TEST123")).toBeNull();
    });

    it("should return null for numeric ID", () => {
      expect(normalizeUrl("123456789")).toBeNull();
    });

    it("should return null for bare username", () => {
      expect(normalizeUrl("john-doe-12345")).toBeNull();
    });

    it("should return null for non-string input", () => {
      expect(normalizeUrl(12345)).toBeNull();
      expect(normalizeUrl({})).toBeNull();
      expect(normalizeUrl(true)).toBeNull();
    });

    it("should accept URL with http scheme", () => {
      expect(normalizeUrl("http://linkedin.com/in/test")).toBe(
        "linkedin.com/in/test",
      );
    });

    it("should accept URL with https scheme", () => {
      expect(normalizeUrl("https://linkedin.com/in/test")).toBe(
        "linkedin.com/in/test",
      );
    });

    it("should accept URL containing linkedin.com without scheme", () => {
      expect(normalizeUrl("linkedin.com/in/test")).toBe("linkedin.com/in/test");
    });

    it("should return null for DuxSoup ID format", () => {
      expect(normalizeUrl("pid.mike-hare")).toBeNull();
      expect(normalizeUrl("id.218248067")).toBeNull();
    });
  });

  describe("normalizeDuxsoupId — Item 16.3", () => {
    it("should lowercase and trim", () => {
      expect(normalizeDuxsoupId("  PID.Mike-Hare  ")).toBe("pid.mike-hare");
    });

    it("should return null for null/empty input", () => {
      expect(normalizeDuxsoupId(null)).toBeNull();
      expect(normalizeDuxsoupId("")).toBeNull();
    });

    it("should handle id. prefix format", () => {
      expect(normalizeDuxsoupId("id.218248067")).toBe("id.218248067");
    });
  });

  describe("extractLinkedInUsername — case-insensitive (Item 16.4)", () => {
    it("should return lowercase for mixed-case Profile URL", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/Mike-HARE/",
      };
      expect(extractLinkedInUsername(data)).toBe("mike-hare");
    });

    it("should return lowercase for mixed-case pid DuxSoup ID", () => {
      const data = {
        id: "pid.Mike-Hare",
      };
      expect(extractLinkedInUsername(data)).toBe("mike-hare");
    });
  });

  describe("extractLinkedInUsername — percent-encoded URLs", () => {
    it("should decode percent-encoded international username", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/fl%C3%A9mke/",
      };
      expect(extractLinkedInUsername(data)).toBe("flémke");
    });

    it("should decode percent-encoded hyphen (%2D)", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/john%2Ddoe/",
      };
      expect(extractLinkedInUsername(data)).toBe("john-doe");
    });

    it("should not crash on malformed percent-encoding", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/john%ZZdoe/",
      };
      // Should not throw; returns whatever it can extract
      expect(() => extractLinkedInUsername(data)).not.toThrow();
      expect(extractLinkedInUsername(data)).toBeTruthy();
    });

    it("should single-decode double-encoded URL", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/john%252Ddoe/",
      };
      // Single decode: %252D → %2D (not fully decoded to -)
      expect(extractLinkedInUsername(data)).toBe("john%2ddoe");
    });
  });

  describe("extractVanityName — percent-encoded URLs", () => {
    it("should decode percent-encoded vanity name", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/fl%C3%A9mke/",
      };
      expect(extractVanityName(data)).toBe("flémke");
    });

    it("should not crash on malformed encoding", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/john%ZZdoe/",
      };
      expect(() => extractVanityName(data)).not.toThrow();
      expect(extractVanityName(data)).toBeTruthy();
    });
  });

  describe("normalizeUrl — percent-encoded characters", () => {
    it("should decode percent-encoded characters in URL", () => {
      const result = normalizeUrl("https://linkedin.com/in/fl%C3%A9mke");
      expect(result).toBe("linkedin.com/in/flémke");
    });

    it("should handle already-decoded URL unchanged", () => {
      const result = normalizeUrl("https://linkedin.com/in/john-doe");
      expect(result).toBe("linkedin.com/in/john-doe");
    });
  });

  describe("safeDecode", () => {
    it("should return null for null input", () => {
      expect(safeDecode(null)).toBeNull();
    });

    it("should return undefined for undefined input", () => {
      expect(safeDecode(undefined)).toBeUndefined();
    });

    it("should decode standard percent-encoding", () => {
      expect(safeDecode("fl%C3%A9mke")).toBe("flémke");
    });

    it("should return original on malformed encoding", () => {
      expect(safeDecode("john%ZZdoe")).toBe("john%ZZdoe");
    });

    it("should handle empty string", () => {
      expect(safeDecode("")).toBe("");
    });
  });

  describe("extractLinkedInUsername — locale-suffixed URLs", () => {
    it("should extract username from URL with /en locale suffix", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/flávia-silva/en",
      };
      expect(extractLinkedInUsername(data)).toBe("flávia-silva");
    });

    it("should extract username from URL with /fr locale suffix", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/jean-dupont/fr",
      };
      expect(extractLinkedInUsername(data)).toBe("jean-dupont");
    });

    it("should extract username from locale URL with trailing slash", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/hans-müller/de/",
      };
      expect(extractLinkedInUsername(data)).toBe("hans-müller");
    });

    it("should extract username from percent-encoded URL with locale suffix", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/fl%C3%A1via-silva/en",
      };
      expect(extractLinkedInUsername(data)).toBe("flávia-silva");
    });

    it("should still extract username from URL without locale suffix", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/john-doe/",
      };
      expect(extractLinkedInUsername(data)).toBe("john-doe");
    });
  });

  describe("extractVanityName — locale-suffixed URLs", () => {
    it("should extract vanity name from URL with /en locale suffix", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/flávia-silva/en",
      };
      expect(extractVanityName(data)).toBe("flávia-silva");
    });

    it("should extract vanity name from URL with /fr locale suffix", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/jean-dupont/fr",
      };
      expect(extractVanityName(data)).toBe("jean-dupont");
    });

    it("should extract vanity name from locale URL with trailing slash", () => {
      const data = {
        Profile: "https://www.linkedin.com/in/hans-müller/de/",
      };
      expect(extractVanityName(data)).toBe("hans-müller");
    });
  });

  describe("normalizeUrl — locale suffix stripping", () => {
    it("should strip /en locale suffix from /in/ profile URL", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/in/flávia-silva/en",
      );
      expect(result).toBe("linkedin.com/in/flávia-silva");
    });

    it("should strip /fr locale suffix from /in/ profile URL", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/jean-dupont/fr");
      expect(result).toBe("linkedin.com/in/jean-dupont");
    });

    it("should not strip 3+ letter path segments (not a locale)", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/john-doe/eng");
      expect(result).toBe("linkedin.com/in/john-doe/eng");
    });

    it("should not strip locale-like segments from non-/in/ paths", () => {
      const result = normalizeUrl("https://www.linkedin.com/company/acme/en");
      expect(result).toBe("linkedin.com/company/acme/en");
    });

    it("should strip locale suffix with trailing slash", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/in/flávia-silva/en/",
      );
      expect(result).toBe("linkedin.com/in/flávia-silva");
    });
  });

  describe("resolvePersonIdentity — locale-suffixed URL end-to-end", () => {
    it("should resolve person identity from locale-suffixed URL", () => {
      const webhookData = {
        id: "pid.flávia-silva",
        Profile: "https://www.linkedin.com/in/fl%C3%A1via-silva/en",
      };

      const result = resolvePersonIdentity(webhookData);

      expect(result.person_id).toBe("flávia-silva");
      expect(result.primary_id_type).toBe("linkedInUsername");
      expect(result.aliases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "linkedInUsername",
            value: "flávia-silva",
          }),
          expect.objectContaining({
            type: "vanityName",
            value: "flávia-silva",
          }),
        ]),
      );
    });

    it("should produce clean profileUrl alias without locale suffix", () => {
      const webhookData = {
        Profile: "https://www.linkedin.com/in/flávia-silva/en",
      };

      const result = resolvePersonIdentity(webhookData);

      const profileUrlAlias = result.aliases.find(
        (a) => a.type === "profileUrl",
      );
      expect(profileUrlAlias).toBeDefined();
      expect(profileUrlAlias.value).toBe("linkedin.com/in/flávia-silva");
      expect(profileUrlAlias.value).not.toContain("/en");
    });
  });
});
