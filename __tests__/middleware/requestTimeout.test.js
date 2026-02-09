jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const requestTimeout = require("../../src/middleware/requestTimeout");
const logger = require("../../src/utils/logger");

/**
 * Helper: create mock req/res/next
 */
function createMocks() {
  const req = {
    id: "req-123",
    method: "GET",
    originalUrl: "/api/test",
  };

  const closeHandlers = [];
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    on: jest.fn((event, handler) => {
      if (event === "close") closeHandlers.push(handler);
    }),
    _triggerClose: () => closeHandlers.forEach((h) => h()),
  };

  const next = jest.fn();

  return { req, res, next };
}

describe("requestTimeout middleware", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should call next() immediately", () => {
    const middleware = requestTimeout(5000);
    const { req, res, next } = createMocks();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("should return 503 after timeout expires", () => {
    const middleware = requestTimeout(100);
    const { req, res, next } = createMocks();

    middleware(req, res, next);

    jest.advanceTimersByTime(100);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "REQUEST_TIMEOUT",
        message: "Request timed out after 100ms",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Request timed out",
      expect.objectContaining({ timeoutMs: 100 }),
    );
  });

  it("should not send timeout response if response already sent", () => {
    const middleware = requestTimeout(100);
    const { req, res, next } = createMocks();

    middleware(req, res, next);

    // Simulate response already sent
    res.headersSent = true;

    jest.advanceTimersByTime(100);

    expect(res.status).not.toHaveBeenCalled();
  });

  it("should clear timer when response closes before timeout", () => {
    const middleware = requestTimeout(5000);
    const { req, res, next } = createMocks();

    middleware(req, res, next);

    // Simulate response completing before timeout
    res._triggerClose();

    jest.advanceTimersByTime(5000);

    expect(res.status).not.toHaveBeenCalled();
  });

  it("should use the configured timeout duration", () => {
    const middleware = requestTimeout(30000);
    const { req, res, next } = createMocks();

    middleware(req, res, next);

    // Not timed out at 29s
    jest.advanceTimersByTime(29999);
    expect(res.status).not.toHaveBeenCalled();

    // Timed out at 30s
    jest.advanceTimersByTime(1);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Request timed out after 30000ms",
      }),
    );
  });
});
