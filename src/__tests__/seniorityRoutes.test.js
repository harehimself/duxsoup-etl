const request = require("supertest");
const express = require("express");
const seniorityRoutes = require("../routes/seniorityRoutes");
const Person = require("../models/person");
const {
  getSeniorityTiers: _getSeniorityTiers,
} = require("../utils/titleParser");

jest.mock("../models/person");

const app = express();
app.use(express.json());
app.use("/api/seniority", seniorityRoutes);

describe("Seniority Routes", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/seniority/tiers", () => {
    it("should return all seniority tiers", async () => {
      const response = await request(app).get("/api/seniority/tiers");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(8);
      expect(response.body.data[0]).toMatchObject({
        tier: "Owner",
        rank: 8,
      });
      expect(response.body.data[7]).toMatchObject({
        tier: "Individual Contributor",
        rank: 1,
      });
    });
  });

  describe("GET /api/seniority/distribution", () => {
    it("should return distribution by highest role (default)", async () => {
      const mockDistribution = [
        { tier: "CXO", count: 100, avgRank: 7 },
        { tier: "VP", count: 200, avgRank: 5 },
      ];

      Person.aggregate = jest.fn().mockResolvedValue(mockDistribution);

      const response = await request(app).get("/api/seniority/distribution");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.groupBy).toBe("highest");
      expect(response.body.data.distribution).toBeDefined();
      expect(response.body.data.total).toBe(300);
    });

    it("should return distribution across all roles", async () => {
      const mockDistribution = [
        { tier: "Manager", count: 500, avgRank: 3 },
        { tier: "Individual Contributor", count: 1000, avgRank: 1 },
      ];

      Person.aggregate = jest.fn().mockResolvedValue(mockDistribution);

      const response = await request(app).get(
        "/api/seniority/distribution?groupBy=all",
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.groupBy).toBe("all");
    });
  });

  describe("GET /api/seniority/filter", () => {
    it("should filter by specific tier", async () => {
      const mockPeople = [
        {
          snapshot: {
            fullName: "John Doe",
            currentTitle: "VP of Engineering",
            roles: [
              { title: "VP of Engineering", seniority: "VP", seniorityRank: 5 },
            ],
          },
          derived: {
            highestSeniority: "VP",
            highestSeniorityRank: 5,
          },
        },
      ];

      Person.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockPeople),
      });

      Person.countDocuments = jest.fn().mockResolvedValue(1);

      const response = await request(app).get("/api/seniority/filter?tier=VP");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.people).toHaveLength(1);
      expect(response.body.data.total).toBe(1);
      expect(response.body.data.filters.tier).toBe("VP");
    });

    it("should filter by minimum rank", async () => {
      const mockPeople = [
        {
          snapshot: {
            fullName: "Jane Smith",
            currentTitle: "CEO",
          },
          derived: {
            highestSeniority: "CXO",
            highestSeniorityRank: 7,
          },
        },
      ];

      Person.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockPeople),
      });

      Person.countDocuments = jest.fn().mockResolvedValue(1);

      const response = await request(app).get(
        "/api/seniority/filter?minRank=5",
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.filters.minRank).toBe("5");
    });

    it("should support pagination", async () => {
      Person.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      Person.countDocuments = jest.fn().mockResolvedValue(1000);

      const response = await request(app).get(
        "/api/seniority/filter?limit=100&offset=200",
      );

      expect(response.status).toBe(200);
      expect(response.body.data.limit).toBe(100);
      expect(response.body.data.offset).toBe(200);
    });

    it("should enforce maximum limit of 500", async () => {
      Person.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      Person.countDocuments = jest.fn().mockResolvedValue(1000);

      const response = await request(app).get(
        "/api/seniority/filter?limit=1000",
      );

      expect(response.status).toBe(200);
      expect(response.body.data.limit).toBe(500); // Capped at 500
    });
  });

  describe("GET /api/seniority/search", () => {
    it("should search by name with seniority filter", async () => {
      const mockPeople = [
        {
          snapshot: {
            fullName: "John Smith",
            currentTitle: "VP of Sales",
          },
          derived: {
            highestSeniority: "VP",
            highestSeniorityRank: 5,
          },
        },
      ];

      Person.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockPeople),
      });

      const response = await request(app).get(
        "/api/seniority/search?q=Smith&tier=VP",
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.people).toHaveLength(1);
      expect(response.body.data.query).toBe("Smith");
    });

    it("should reject queries shorter than 2 characters", async () => {
      const response = await request(app).get("/api/seniority/search?q=J");

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("INVALID_QUERY");
    });

    it("should filter by minimum rank", async () => {
      Person.find = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      const response = await request(app).get(
        "/api/seniority/search?q=John&minRank=6",
      );

      expect(response.status).toBe(200);
      expect(Person.find).toHaveBeenCalledWith(
        expect.objectContaining({
          "derived.highestSeniorityRank": { $gte: 6 },
        }),
      );
    });
  });

  describe("GET /api/seniority/stats", () => {
    it("should return comprehensive statistics", async () => {
      const mockDistByHighest = [
        { _id: "CXO", count: 100 },
        { _id: "VP", count: 200 },
      ];

      const mockDistByAll = [
        { _id: "Manager", count: 500 },
        { _id: "Individual Contributor", count: 1000 },
      ];

      const mockTopCompanies = [
        { _id: "Acme Corp", count: 50, avgRank: 6 },
        { _id: "TechCo", count: 40, avgRank: 5.5 },
      ];

      Person.aggregate = jest
        .fn()
        .mockResolvedValueOnce(mockDistByHighest)
        .mockResolvedValueOnce(mockDistByAll)
        .mockResolvedValueOnce(mockTopCompanies);

      const response = await request(app).get("/api/seniority/stats");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.byHighestRole).toBeDefined();
      expect(response.body.data.byAllRoles).toBeDefined();
      expect(response.body.data.topCompaniesWithSeniorLeaders).toBeDefined();
    });
  });
});
