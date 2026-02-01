const request = require("supertest");
const express = require("express");

function createApp(nodeEnv) {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  const app = express();

  // Test route that throws a generic error
  app.get("/error", (req, res, next) => {
    next(new Error("Something broke"));
  });

  // Test route that throws with a custom status
  app.get("/not-found", (req, res, next) => {
    const err = new Error("Resource not found");
    err.status = 404;
    next(err);
  });

  // Global error handler (mirrors src/index.js implementation)
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const response = {
      success: false,
      error: "INTERNAL_ERROR",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : err.message,
    };

    res.status(status).json(response);
  });

  // Restore original NODE_ENV after app creation
  process.env.NODE_ENV = originalEnv;

  return app;
}

describe("Global Error Handler Middleware", () => {
  describe("in development mode", () => {
    const app = createApp("development");

    it("should return structured JSON for unhandled errors", async () => {
      const res = await request(app).get("/error");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        error: "INTERNAL_ERROR",
        message: "Something broke",
      });
    });

    it("should respect err.status when set", async () => {
      const res = await request(app).get("/not-found");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Resource not found");
    });
  });

  describe("in production mode", () => {
    let originalEnv;

    beforeAll(() => {
      originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
    });

    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it("should hide error details in production", async () => {
      const app = express();

      app.get("/error", (req, res, next) => {
        next(new Error("Secret internal details"));
      });

      app.use((err, req, res, _next) => {
        const status = err.status || err.statusCode || 500;
        const response = {
          success: false,
          error: "INTERNAL_ERROR",
          message:
            process.env.NODE_ENV === "production"
              ? "An unexpected error occurred"
              : err.message,
        };
        res.status(status).json(response);
      });

      const res = await request(app).get("/error");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("INTERNAL_ERROR");
      expect(res.body.message).toBe("An unexpected error occurred");
      expect(res.body.message).not.toContain("Secret internal details");
    });
  });
});
