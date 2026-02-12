jest.mock("../../src/services/timelineService", () => ({
  getPersonTimeline: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  getPersonTimeline: getPersonTimelineSvc,
} = require("../../src/services/timelineService");
const {
  getPersonTimeline,
} = require("../../src/controllers/timelineController");

function mockReqRes(params = {}, query = {}) {
  const req = { params, query };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("timelineController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPersonTimeline()", () => {
    it("should return 200 with timeline data for a valid person", async () => {
      const timeline = [
        {
          timestamp: new Date("2025-01-15"),
          type: "visit",
          source: { type: "visit", id: "v1" },
          snapshot: {
            currentTitle: "VP",
            currentCompany: "Acme",
            location: "NYC",
          },
        },
      ];
      getPersonTimelineSvc.mockResolvedValue({
        timeline,
        metadata: {
          totalEvents: 1,
          dateRange: {
            from: new Date("2025-01-15"),
            to: new Date("2025-01-15"),
          },
        },
      });

      const { req, res, next } = mockReqRes({ id: "ACwAAABCDEF" });
      await getPersonTimeline(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            personId: "ACwAAABCDEF",
            timeline,
          }),
          total: 1,
          limit: 50,
          offset: 0,
        }),
      );
    });

    it("should return 404 when person is not found", async () => {
      getPersonTimelineSvc.mockResolvedValue(null);

      const { req, res, next } = mockReqRes({ id: "no-such" });
      await getPersonTimeline(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: "NOT_FOUND",
        }),
      );
    });

    it("should return 400 for invalid 'from' date", async () => {
      const { req, res, next } = mockReqRes(
        { id: "ACwAAABCDEF" },
        { from: "not-a-date" },
      );
      await getPersonTimeline(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "VALIDATION_ERROR",
          message: expect.stringContaining("from"),
        }),
      );
    });

    it("should return 400 for invalid 'to' date", async () => {
      const { req, res, next } = mockReqRes(
        { id: "ACwAAABCDEF" },
        { to: "bad-date" },
      );
      await getPersonTimeline(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "VALIDATION_ERROR",
          message: expect.stringContaining("to"),
        }),
      );
    });

    it("should use default limit and offset when not provided", async () => {
      getPersonTimelineSvc.mockResolvedValue({
        timeline: [],
        metadata: { totalEvents: 0, dateRange: { from: null, to: null } },
      });

      const { req, res, next } = mockReqRes({ id: "ACwAAABCDEF" });
      await getPersonTimeline(req, res, next);

      expect(getPersonTimelineSvc).toHaveBeenCalledWith("ACwAAABCDEF", {
        limit: 50,
        offset: 0,
        from: undefined,
        to: undefined,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 0 }),
      );
    });

    it("should cap limit at 500", async () => {
      getPersonTimelineSvc.mockResolvedValue({
        timeline: [],
        metadata: { totalEvents: 0, dateRange: { from: null, to: null } },
      });

      const { req, res, next } = mockReqRes(
        { id: "ACwAAABCDEF" },
        { limit: "9999" },
      );
      await getPersonTimeline(req, res, next);

      expect(getPersonTimelineSvc).toHaveBeenCalledWith("ACwAAABCDEF", {
        limit: 500,
        offset: 0,
        from: undefined,
        to: undefined,
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500 }),
      );
    });

    it("should pass custom limit and offset", async () => {
      getPersonTimelineSvc.mockResolvedValue({
        timeline: [],
        metadata: { totalEvents: 0, dateRange: { from: null, to: null } },
      });

      const { req, res, next } = mockReqRes(
        { id: "ACwAAABCDEF" },
        { limit: "25", offset: "10" },
      );
      await getPersonTimeline(req, res, next);

      expect(getPersonTimelineSvc).toHaveBeenCalledWith("ACwAAABCDEF", {
        limit: 25,
        offset: 10,
        from: undefined,
        to: undefined,
      });
    });

    it("should call next(err) on service error", async () => {
      const error = new Error("DB failure");
      getPersonTimelineSvc.mockRejectedValue(error);

      const { req, res, next } = mockReqRes({ id: "ACwAAABCDEF" });
      await getPersonTimeline(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
