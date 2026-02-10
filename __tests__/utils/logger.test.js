describe("Logger", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should default to debug level in development", () => {
    process.env.NODE_ENV = "development";
    const logger = require("../../src/utils/logger");
    expect(logger.level).toBe("debug");
  });

  it("should default to info level in production", () => {
    process.env.NODE_ENV = "production";
    const logger = require("../../src/utils/logger");
    expect(logger.level).toBe("info");
  });

  it("should use LOG_LEVEL to override production default", () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "warn";
    const logger = require("../../src/utils/logger");
    expect(logger.level).toBe("warn");
  });

  it("should use LOG_LEVEL to override development default", () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "error";
    const logger = require("../../src/utils/logger");
    expect(logger.level).toBe("error");
  });
});
