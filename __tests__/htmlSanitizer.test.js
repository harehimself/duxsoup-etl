jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { stripHtmlTags } = require("../src/utils/htmlSanitizer");
const logger = require("../src/utils/logger");

describe("stripHtmlTags", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Null/empty/non-string guards ──

  describe("null/empty/non-string guards", () => {
    it("should return null for null input", () => {
      expect(stripHtmlTags(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(stripHtmlTags(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(stripHtmlTags("")).toBeNull();
    });

    it("should return null for non-string types", () => {
      expect(stripHtmlTags(42)).toBeNull();
      expect(stripHtmlTags(true)).toBeNull();
      expect(stripHtmlTags({})).toBeNull();
      expect(stripHtmlTags([])).toBeNull();
    });

    it("should return plain text unchanged", () => {
      expect(stripHtmlTags("Hello world")).toBe("Hello world");
    });
  });

  // ── HTML tag stripping ──

  describe("HTML tag stripping", () => {
    it("should strip simple HTML tags", () => {
      expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello");
    });

    it("should strip <br> and <br/> tags", () => {
      expect(stripHtmlTags("Line 1<br>Line 2")).toBe("Line 1Line 2");
      expect(stripHtmlTags("Line 1<br/>Line 2")).toBe("Line 1Line 2");
      expect(stripHtmlTags("Line 1<br />Line 2")).toBe("Line 1Line 2");
    });

    it("should strip nested tags", () => {
      expect(stripHtmlTags("<div><p>Nested</p></div>")).toBe("Nested");
    });

    it("should strip self-closing tags", () => {
      expect(stripHtmlTags("Before<hr/>After")).toBe("BeforeAfter");
    });

    it("should strip tags with attributes", () => {
      expect(stripHtmlTags('<a href="https://example.com">Link</a>')).toBe(
        "Link",
      );
      expect(stripHtmlTags('<span class="bold" id="test">Text</span>')).toBe(
        "Text",
      );
    });

    it("should strip list items", () => {
      expect(stripHtmlTags("<ul><li>Item 1</li><li>Item 2</li></ul>")).toBe(
        "Item 1Item 2",
      );
    });

    it("should handle mixed content with tags and text", () => {
      expect(stripHtmlTags("Start <b>bold</b> and <i>italic</i> end")).toBe(
        "Start bold and italic end",
      );
    });

    it("should strip multiple consecutive tags", () => {
      expect(stripHtmlTags("<p></p><p>Content</p><p></p>")).toBe("Content");
    });
  });

  // ── Entity decoding ──

  describe("entity decoding", () => {
    it("should decode &amp;", () => {
      expect(stripHtmlTags("R&amp;D")).toBe("R&D");
    });

    it("should decode &lt;", () => {
      expect(stripHtmlTags("5 &lt; 10")).toBe("5 < 10");
    });

    it("should decode &gt;", () => {
      expect(stripHtmlTags("10 &gt; 5")).toBe("10 > 5");
    });

    it("should decode &nbsp;", () => {
      expect(stripHtmlTags("Hello&nbsp;World")).toBe("Hello World");
    });

    it("should decode &#39;", () => {
      expect(stripHtmlTags("It&#39;s fine")).toBe("It's fine");
    });

    it("should decode &quot;", () => {
      expect(stripHtmlTags("&quot;quoted&quot;")).toBe('"quoted"');
    });

    it("should decode multiple entities in one string", () => {
      expect(stripHtmlTags("R&amp;D &lt;Team&gt;")).toBe("R&D <Team>");
    });
  });

  // ── Combined tags + entities ──

  describe("combined tags and entities", () => {
    it("should strip tags and decode entities in realistic LinkedIn summary", () => {
      const input =
        "<p>Experienced in R&amp;D and product management.</p><br><p>Led teams of 10&gt; engineers.</p>";
      expect(stripHtmlTags(input)).toBe(
        "Experienced in R&D and product management.Led teams of 10> engineers.",
      );
    });

    it("should handle role description with HTML formatting", () => {
      const input =
        "<ul><li>Managed P&amp;L for $50M division</li><li>Led 20+ reports</li></ul>";
      expect(stripHtmlTags(input)).toBe(
        "Managed P&L for $50M divisionLed 20+ reports",
      );
    });

    it("should handle summary with links and entities", () => {
      const input =
        'Visit <a href="https://example.com">our site</a> for R&amp;D info &amp; more.';
      expect(stripHtmlTags(input)).toBe("Visit our site for R&D info & more.");
    });
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    it("should return null when only whitespace remains after stripping", () => {
      expect(stripHtmlTags("<p>  </p>")).toBeNull();
      expect(stripHtmlTags("<br><br>")).toBeNull();
    });

    it("should handle unmatched angle brackets as literal text", () => {
      // The regex /<[^>]*>/g will only strip complete tags
      expect(stripHtmlTags("5 < 10 and 10 > 5")).toBe("5  5");
    });

    it("should handle long text with sparse HTML", () => {
      const longText = "A".repeat(4000) + "<br>" + "B".repeat(1000);
      const result = stripHtmlTags(longText);
      expect(result).toBe("A".repeat(4000) + "B".repeat(1000));
    });

    it("should handle entities at string boundaries", () => {
      expect(stripHtmlTags("&amp;start")).toBe("&start");
      expect(stripHtmlTags("end&amp;")).toBe("end&");
    });
  });

  // ── Logging ──

  describe("logging", () => {
    it("should log debug when HTML was stripped", () => {
      stripHtmlTags("<p>Hello</p>");
      expect(logger.debug).toHaveBeenCalledWith(
        "Stripped HTML from text field",
        expect.objectContaining({
          originalLength: expect.any(Number),
          cleanedLength: expect.any(Number),
        }),
      );
    });

    it("should not log for plain text without HTML", () => {
      stripHtmlTags("Plain text without HTML");
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });
});
