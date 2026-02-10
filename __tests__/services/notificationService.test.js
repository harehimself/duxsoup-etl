const nodemailer = require("nodemailer");

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
}));

jest.mock("twilio", () =>
  jest.fn(() => ({
    messages: { create: jest.fn() },
  })),
);

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("NotificationService", () => {
  let sendHealthEmail;
  let sendHealthAlerts;
  let _resetTransporter;
  let _resetAlertDedup;
  let mockSendMail;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up env vars before requiring the module
    process.env.SMTP_HOST = "smtp.test.com";
    process.env.SMTP_USER = "user@test.com";
    process.env.SMTP_PASS = "pass";
    process.env.ALERT_EMAIL_TO = "admin@test.com";

    mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-1" });
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });

    // Re-require to pick up env vars
    jest.isolateModules(() => {
      const mod = require("../../src/services/notificationService");
      sendHealthEmail = mod.sendHealthEmail;
      sendHealthAlerts = mod.sendHealthAlerts;
      _resetTransporter = mod._resetTransporter;
      _resetAlertDedup = mod._resetAlertDedup;
    });
  });

  afterEach(() => {
    // Always reset dedup state between tests
    if (_resetAlertDedup) _resetAlertDedup();

    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.ALERT_EMAIL_TO;
  });

  describe("SMTP transporter reuse", () => {
    it("should create transporter only once across multiple sends", async () => {
      const report = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "test", recommendation: "none" }],
      };

      await sendHealthEmail(report);
      await sendHealthEmail(report);
      await sendHealthEmail(report);

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledTimes(3);
    });

    it("should create a new transporter after reset", async () => {
      const report = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "test", recommendation: "none" }],
      };

      await sendHealthEmail(report);
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);

      _resetTransporter();

      await sendHealthEmail(report);
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });
  });

  describe("Alert deduplication", () => {
    it("should send alert on first call", async () => {
      const report = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "Low coverage", recommendation: "Investigate" }],
      };

      const result = await sendHealthAlerts(report);

      expect(result.emailSent).toBe(true);
      expect(result.suppressed).toBe(false);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it("should suppress duplicate alert on second call", async () => {
      const report = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "Low coverage", recommendation: "Investigate" }],
      };

      const first = await sendHealthAlerts(report);
      expect(first.suppressed).toBe(false);
      expect(first.emailSent).toBe(true);

      const second = await sendHealthAlerts(report);
      expect(second.suppressed).toBe(true);
      expect(second.emailSent).toBe(false);
      expect(second.smsSent).toBe(false);

      // Email should only have been sent once
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it("should suppress even when metric values change", async () => {
      const report1 = {
        status: "warning",
        timestamp: new Date("2025-01-01"),
        warnings: [{ message: "Low coverage", recommendation: "Investigate" }],
        metrics: { canonicalIdCoverage: 80.1 },
      };
      const report2 = {
        status: "warning",
        timestamp: new Date("2025-01-02"),
        warnings: [{ message: "Low coverage", recommendation: "Investigate" }],
        metrics: { canonicalIdCoverage: 79.5 },
      };

      await sendHealthAlerts(report1);
      const second = await sendHealthAlerts(report2);

      expect(second.suppressed).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it("should send new alert when status escalates from warning to critical", async () => {
      const warningReport = {
        status: "warning",
        timestamp: new Date(),
        warnings: [
          { message: "Dead letters rising", recommendation: "Monitor" },
        ],
      };
      const criticalReport = {
        status: "critical",
        timestamp: new Date(),
        criticalIssues: [
          { message: "Dead letters rising", recommendation: "Fix now" },
        ],
      };

      await sendHealthAlerts(warningReport);
      const second = await sendHealthAlerts(criticalReport);

      expect(second.suppressed).toBe(false);
      expect(second.emailSent).toBe(true);
      // Both calls sent email
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it("should send new alert when different issues appear", async () => {
      const report1 = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "Issue A", recommendation: "Fix A" }],
      };
      const report2 = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "Issue B", recommendation: "Fix B" }],
      };

      await sendHealthAlerts(report1);
      const second = await sendHealthAlerts(report2);

      expect(second.suppressed).toBe(false);
      expect(second.emailSent).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it("should include suppressed: false on healthy status (no dispatch)", async () => {
      const report = {
        status: "healthy",
        timestamp: new Date(),
      };

      const result = await sendHealthAlerts(report);

      expect(result.suppressed).toBe(false);
      expect(result.emailSent).toBe(false);
      expect(result.smsSent).toBe(false);
    });

    it("should reset dedup state via _resetAlertDedup", async () => {
      const report = {
        status: "warning",
        timestamp: new Date(),
        warnings: [{ message: "Test issue", recommendation: "Fix" }],
      };

      await sendHealthAlerts(report);
      _resetAlertDedup();

      // After reset, the same report should send again
      const result = await sendHealthAlerts(report);
      expect(result.suppressed).toBe(false);
      expect(result.emailSent).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });
  });
});
