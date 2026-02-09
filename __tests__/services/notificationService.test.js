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
  let _resetTransporter;
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
      _resetTransporter = mod._resetTransporter;
    });
  });

  afterEach(() => {
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
});
