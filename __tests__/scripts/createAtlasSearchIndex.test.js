const { getDatabaseName } = require("../../scripts/createAtlasSearchIndex");

describe("getDatabaseName", () => {
  const fallback = "fallback-db";

  it("extracts database from standard mongodb+srv URI", () => {
    const uri =
      "mongodb+srv://user:pass@cluster0.abc12.mongodb.net/duxsoup-etl?retryWrites=true";
    expect(getDatabaseName(uri, fallback)).toBe("duxsoup-etl");
  });

  it("extracts database from standard mongodb URI", () => {
    const uri = "mongodb://localhost:27017/duxsoup-etl";
    expect(getDatabaseName(uri, fallback)).toBe("duxsoup-etl");
  });

  it("extracts database from URI with query params", () => {
    const uri =
      "mongodb+srv://user:pass@host/duxsoup-etl-prod?retryWrites=true&w=majority";
    expect(getDatabaseName(uri, fallback)).toBe("duxsoup-etl-prod");
  });

  it("returns fallback when URI has no database path", () => {
    const uri = "mongodb+srv://user:pass@cluster0.abc12.mongodb.net/";
    expect(getDatabaseName(uri, fallback)).toBe(fallback);
  });

  it("returns fallback when URI is null or undefined", () => {
    expect(getDatabaseName(null, fallback)).toBe(fallback);
    expect(getDatabaseName(undefined, fallback)).toBe(fallback);
  });

  it("returns fallback when URI is empty string", () => {
    expect(getDatabaseName("", fallback)).toBe(fallback);
  });

  it("handles URI without protocol via regex fallback", () => {
    // Malformed URI that URL() can't parse but regex can
    const uri = "mongodb://user:p@ss[bracket@host:27017/my-db?opt=1";
    expect(getDatabaseName(uri, fallback)).toBe("my-db");
  });
});
