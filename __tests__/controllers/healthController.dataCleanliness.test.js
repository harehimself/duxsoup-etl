/**
 * Unit tests for healthController.getDataCleanliness()
 */

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../../src/models/person", () => ({
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));

jest.mock("../../src/models/visit", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/models/scan", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
}));

const metricsCache = require("../../src/utils/metricsCache");
const Person = require("../../src/models/person");

const {
  getDataCleanliness,
} = require("../../src/controllers/healthController");

function buildReqRes(query = {}) {
  const req = { query };
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return { req, res };
}

beforeEach(() => {
  jest.clearAllMocks();
  metricsCache.invalidateAll();
});

describe("getDataCleanliness()", () => {
  function stubAggregates({
    totalPeople = 1000,
    whitespaceSample = [{ sampled: 1000, withIssues: 50 }],
    emailResults = [{ total: 500, invalid: 10 }],
    skillResults = [{ total: 300, withDuplicates: 20 }],
    educationResults = [{ total: 200, withDuplicates: 5 }],
    missingFieldResults = [
      { total: 1000, missingEmail: 600, missingPhone: 800, missingTitle: 100 },
    ],
  } = {}) {
    Person.countDocuments.mockResolvedValue(totalPeople);
    // aggregate is called 5 times in Promise.all
    Person.aggregate
      .mockResolvedValueOnce(whitespaceSample)
      .mockResolvedValueOnce(emailResults)
      .mockResolvedValueOnce(skillResults)
      .mockResolvedValueOnce(educationResults)
      .mockResolvedValueOnce(missingFieldResults);
  }

  it("should return expected response shape", async () => {
    stubAggregates();
    const { req, res } = buildReqRes({ fresh: "true" });

    await getDataCleanliness(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        totalPeople: 1000,
        whitespace: expect.objectContaining({
          sampled: 1000,
          withIssues: 50,
          percentage: expect.any(Number),
        }),
        email: expect.objectContaining({
          totalWithEmail: 500,
          invalid: 10,
          percentage: expect.any(Number),
        }),
        skills: expect.objectContaining({
          totalWithSkills: 300,
          withDuplicates: 20,
          percentage: expect.any(Number),
        }),
        education: expect.objectContaining({
          totalWithEducation: 200,
          withDuplicates: 5,
          percentage: expect.any(Number),
        }),
        missingFields: expect.objectContaining({
          total: 1000,
          missingEmail: expect.objectContaining({
            count: 600,
            percentage: expect.any(Number),
          }),
          missingPhone: expect.objectContaining({
            count: 800,
            percentage: expect.any(Number),
          }),
          missingTitle: expect.objectContaining({
            count: 100,
            percentage: expect.any(Number),
          }),
        }),
        timestamp: expect.any(String),
      }),
    });
  });

  it("should handle zero records gracefully", async () => {
    stubAggregates({
      totalPeople: 0,
      whitespaceSample: [],
      emailResults: [],
      skillResults: [],
      educationResults: [],
      missingFieldResults: [],
    });
    const { req, res } = buildReqRes({ fresh: "true" });

    await getDataCleanliness(req, res);

    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(true);
    expect(response.data.totalPeople).toBe(0);
    expect(response.data.whitespace.sampled).toBe(0);
    expect(response.data.whitespace.percentage).toBe(0);
    expect(response.data.email.totalWithEmail).toBe(0);
    expect(response.data.skills.totalWithSkills).toBe(0);
    expect(response.data.education.totalWithEducation).toBe(0);
  });

  it("should bypass cache when fresh=true", async () => {
    stubAggregates({ totalPeople: 100 });
    const { req, res } = buildReqRes({ fresh: "true" });

    await getDataCleanliness(req, res);

    expect(Person.countDocuments).toHaveBeenCalled();
    expect(Person.aggregate).toHaveBeenCalledTimes(5);
  });

  it("should return 500 on error", async () => {
    Person.countDocuments.mockRejectedValue(new Error("DB down"));
    const { req, res } = buildReqRes({ fresh: "true" });

    await getDataCleanliness(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Failed to compute data cleanliness metrics",
      }),
    );
  });

  it("should compute correct percentages", async () => {
    stubAggregates({
      totalPeople: 1000,
      whitespaceSample: [{ sampled: 100, withIssues: 25 }],
      emailResults: [{ total: 200, invalid: 10 }],
      skillResults: [{ total: 100, withDuplicates: 50 }],
      educationResults: [{ total: 50, withDuplicates: 10 }],
      missingFieldResults: [
        {
          total: 1000,
          missingEmail: 500,
          missingPhone: 750,
          missingTitle: 100,
        },
      ],
    });
    const { req, res } = buildReqRes({ fresh: "true" });

    await getDataCleanliness(req, res);

    const data = res.json.mock.calls[0][0].data;
    expect(data.whitespace.percentage).toBe(25);
    expect(data.email.percentage).toBe(5);
    expect(data.skills.percentage).toBe(50);
    expect(data.education.percentage).toBe(20);
    expect(data.missingFields.missingEmail.percentage).toBe(50);
    expect(data.missingFields.missingPhone.percentage).toBe(75);
    expect(data.missingFields.missingTitle.percentage).toBe(10);
  });
});
