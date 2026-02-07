/**
 * Dead Letter Alerting Integration Test
 *
 * Verifies the end-to-end pipeline:
 *   Dead letter backlog → Health check detection → Alert firing (email/SMS)
 *
 * Thresholds (from healthCheck.js):
 *   - CRITICAL: >100 pending dead letters
 *   - WARNING:  >50 failed_again dead letters
 *   - CRITICAL: >10% people missing canonical_id
 *
 * Alert routing (from notificationService.js):
 *   - Email: sent for 'warning' or 'critical' status
 *   - SMS:   sent for 'critical' status only
 */

// ── Environment variables (must be set before notificationService loads) ──
process.env.SMTP_HOST = "smtp.test.com";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "test@test.com";
process.env.SMTP_PASS = "testpass";
process.env.ALERT_EMAIL_FROM = "etl@test.com";
process.env.ALERT_EMAIL_TO = "ops@test.com";
process.env.TWILIO_ACCOUNT_SID = "ACtest123";
process.env.TWILIO_AUTH_TOKEN = "auth_token_test";
process.env.TWILIO_FROM_NUMBER = "+15551234567";
process.env.TWILIO_TO_NUMBER = "+15559876543";

// ── Mock tracking fns (stable references across resets) ──
const mockSendMail = jest.fn();
const mockTwilioCreate = jest.fn();

// ── External service mocks (hoisted by Jest) ──
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

jest.mock("twilio", () =>
  jest.fn(() => ({
    messages: { create: mockTwilioCreate },
  })),
);

// ── Model mocks ──
jest.mock("../../src/models/person", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/models/deadLetter", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Requires (after mocks and env vars are in place) ──
const { runHealthCheck } = require("../../src/workers/jobs/healthCheck");
const { sendHealthAlerts } = require("../../src/services/notificationService");
const Person = require("../../src/models/person");
const DeadLetter = require("../../src/models/deadLetter");
const nodemailer = require("nodemailer");

describe("Dead Letter Alerting Integration", () => {
  beforeEach(() => {
    // Re-setup implementations after resetMocks clears them
    mockSendMail.mockResolvedValue({ messageId: "test-msg-id" });
    mockTwilioCreate.mockResolvedValue({ sid: "SM_test", status: "queued" });
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });
  });

  /**
   * Helper: configure mock DB counts for the health check.
   *
   * runHealthCheck() calls countDocuments in this order:
   *   1. Person.countDocuments()           → totalPeople
   *   2. Person.countDocuments({$or:...})  → missingCanonicalId
   *   3. DeadLetter.countDocuments({status:'pending'})
   *   4. DeadLetter.countDocuments({status:'failed_again'})
   */
  function setupDbCounts({
    totalPeople = 100,
    missingCanonical = 0,
    pendingDL = 0,
    failedDL = 0,
  }) {
    Person.countDocuments
      .mockResolvedValueOnce(totalPeople)
      .mockResolvedValueOnce(missingCanonical);

    DeadLetter.countDocuments
      .mockResolvedValueOnce(pendingDL)
      .mockResolvedValueOnce(failedDL);
  }

  // ─────────────────────────────────────────────
  // Scenario 1: Below all thresholds → no alerts
  // ─────────────────────────────────────────────
  describe("when dead letter counts are below thresholds", () => {
    it('should report "good" status and not send any alerts', async () => {
      setupDbCounts({ pendingDL: 50, failedDL: 30 });

      const report = await runHealthCheck();

      expect(report.status).toBe("good");
      expect(report.criticalIssues).toHaveLength(0);
      expect(report.warnings).toHaveLength(0);
      expect(report.metrics.pendingDeadLetters).toBe(50);
      expect(report.metrics.failedAgainDeadLetters).toBe(30);

      const alertResult = await sendHealthAlerts(report);
      expect(alertResult.emailSent).toBe(false);
      expect(alertResult.smsSent).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockTwilioCreate).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 2: failed_again > 50 → warning → email only
  // ─────────────────────────────────────────────
  describe("when failed_again dead letters exceed warning threshold (>50)", () => {
    it('should report "warning" status and send email but not SMS', async () => {
      setupDbCounts({ pendingDL: 10, failedDL: 75 });

      const report = await runHealthCheck();

      expect(report.status).toBe("warning");
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0].type).toBe("failed_dead_letters");
      expect(report.warnings[0].message).toContain("75");
      expect(report.warnings[0].message).toContain("threshold: 50");
      expect(report.criticalIssues).toHaveLength(0);

      const alertResult = await sendHealthAlerts(report);
      expect(alertResult.emailSent).toBe(true);
      expect(alertResult.smsSent).toBe(false);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockTwilioCreate).not.toHaveBeenCalled();
    });

    it("should include dead letter metrics in email content", async () => {
      setupDbCounts({ pendingDL: 10, failedDL: 75 });

      const report = await runHealthCheck();
      await sendHealthAlerts(report);

      const emailArgs = mockSendMail.mock.calls[0][0];
      expect(emailArgs.subject).toContain("WARNING");
      expect(emailArgs.to).toBe("ops@test.com");
      expect(emailArgs.html).toContain("75");
      expect(emailArgs.text).toContain("75");
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 3: pending > 100 → critical → email + SMS
  // ─────────────────────────────────────────────
  describe("when pending dead letters exceed critical threshold (>100)", () => {
    it('should report "critical" status and send both email and SMS', async () => {
      setupDbCounts({ pendingDL: 150, failedDL: 10 });

      const report = await runHealthCheck();

      expect(report.status).toBe("critical");
      expect(report.criticalIssues).toHaveLength(1);
      expect(report.criticalIssues[0].type).toBe("dead_letter_backlog");
      expect(report.criticalIssues[0].message).toContain("150");
      expect(report.criticalIssues[0].message).toContain("threshold: 100");
      expect(report.criticalIssues[0].recommendation).toContain("replay");

      const alertResult = await sendHealthAlerts(report);
      expect(alertResult.emailSent).toBe(true);
      expect(alertResult.smsSent).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    });

    it("should include dead letter backlog details in SMS", async () => {
      setupDbCounts({ pendingDL: 150, failedDL: 10 });

      const report = await runHealthCheck();
      await sendHealthAlerts(report);

      const smsArgs = mockTwilioCreate.mock.calls[0][0];
      expect(smsArgs.body).toContain("150");
      expect(smsArgs.from).toBe("+15551234567");
      expect(smsArgs.to).toBe("+15559876543");
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 4: Both thresholds exceeded
  // ─────────────────────────────────────────────
  describe("when both pending and failed_again thresholds are exceeded", () => {
    it('should report "critical" with both issues and send email + SMS', async () => {
      setupDbCounts({ pendingDL: 200, failedDL: 75 });

      const report = await runHealthCheck();

      expect(report.status).toBe("critical");
      // pending > 100 is critical
      expect(report.criticalIssues).toHaveLength(1);
      expect(report.criticalIssues[0].type).toBe("dead_letter_backlog");
      // failed_again > 50 is warning
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0].type).toBe("failed_dead_letters");

      const alertResult = await sendHealthAlerts(report);
      expect(alertResult.emailSent).toBe(true);
      expect(alertResult.smsSent).toBe(true);
    });

    it("should include both issues in email content", async () => {
      setupDbCounts({ pendingDL: 200, failedDL: 75 });

      const report = await runHealthCheck();
      await sendHealthAlerts(report);

      const emailArgs = mockSendMail.mock.calls[0][0];
      // Email should mention both dead letter issues
      expect(emailArgs.html).toContain("200"); // pending count
      expect(emailArgs.html).toContain("75"); // failed_again count
      expect(emailArgs.text).toContain("200");
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 5: Boundary conditions
  // ─────────────────────────────────────────────
  describe("boundary conditions", () => {
    it("should NOT alert when pending is exactly 100 (threshold is >100)", async () => {
      setupDbCounts({ pendingDL: 100, failedDL: 50 });

      const report = await runHealthCheck();

      expect(report.status).toBe("good");
      expect(report.criticalIssues).toHaveLength(0);
      expect(report.warnings).toHaveLength(0);
    });

    it("should alert when pending is 101 (just over threshold)", async () => {
      setupDbCounts({ pendingDL: 101, failedDL: 0 });

      const report = await runHealthCheck();

      expect(report.status).toBe("critical");
      expect(report.criticalIssues).toHaveLength(1);
      expect(report.criticalIssues[0].type).toBe("dead_letter_backlog");
    });

    it("should NOT warn when failed_again is exactly 50 (threshold is >50)", async () => {
      setupDbCounts({ pendingDL: 0, failedDL: 50 });

      const report = await runHealthCheck();

      expect(report.status).toBe("good");
      expect(report.warnings).toHaveLength(0);
    });

    it("should warn when failed_again is 51 (just over threshold)", async () => {
      setupDbCounts({ pendingDL: 0, failedDL: 51 });

      const report = await runHealthCheck();

      expect(report.status).toBe("warning");
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0].type).toBe("failed_dead_letters");
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 6: Full pipeline (health check → alerting)
  // ─────────────────────────────────────────────
  describe("full pipeline: health check → alerting", () => {
    it("should detect critical backlog and trigger both email and SMS alerts", async () => {
      setupDbCounts({
        pendingDL: 250,
        failedDL: 80,
        totalPeople: 1000,
        missingCanonical: 5,
      });

      // Step 1: Run health check
      const report = await runHealthCheck();

      // Step 2: Verify detection
      expect(report.status).toBe("critical");
      expect(report.metrics.pendingDeadLetters).toBe(250);
      expect(report.metrics.failedAgainDeadLetters).toBe(80);

      // Step 3: Fire alerts
      const alertResult = await sendHealthAlerts(report);

      // Step 4: Verify both channels fired
      expect(alertResult.emailSent).toBe(true);
      expect(alertResult.smsSent).toBe(true);

      // Step 5: Verify email contains actionable details
      const emailArgs = mockSendMail.mock.calls[0][0];
      expect(emailArgs.subject).toContain("CRITICAL");
      expect(emailArgs.html).toContain("250");
      expect(emailArgs.html).toContain("Pending Dead Letters");
      expect(emailArgs.text).toContain("Pending Dead Letters");

      // Step 6: Verify SMS was sent with critical marker
      const smsArgs = mockTwilioCreate.mock.calls[0][0];
      expect(smsArgs.body).toContain("CRITICAL");
    });

    it("should detect warning-level backlog and trigger email only", async () => {
      setupDbCounts({
        pendingDL: 20,
        failedDL: 60,
        totalPeople: 500,
        missingCanonical: 10,
      });

      const report = await runHealthCheck();
      expect(report.status).toBe("warning");

      const alertResult = await sendHealthAlerts(report);
      expect(alertResult.emailSent).toBe(true);
      expect(alertResult.smsSent).toBe(false);
      expect(mockTwilioCreate).not.toHaveBeenCalled();
    });

    it("should report clean health and skip all notifications", async () => {
      setupDbCounts({
        pendingDL: 0,
        failedDL: 0,
        totalPeople: 500,
        missingCanonical: 0,
      });

      const report = await runHealthCheck();
      expect(report.status).toBe("good");

      const alertResult = await sendHealthAlerts(report);
      expect(alertResult.emailSent).toBe(false);
      expect(alertResult.smsSent).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockTwilioCreate).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 7: Notification failure resilience
  // ─────────────────────────────────────────────
  describe("notification failure handling", () => {
    it("should return emailSent:false when SMTP fails but still attempt SMS", async () => {
      setupDbCounts({ pendingDL: 150, failedDL: 0 });
      mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));

      const report = await runHealthCheck();
      const alertResult = await sendHealthAlerts(report);

      expect(alertResult.emailSent).toBe(false);
      expect(alertResult.smsSent).toBe(true);
    });

    it("should return smsSent:false when Twilio fails but email still succeeds", async () => {
      setupDbCounts({ pendingDL: 150, failedDL: 0 });
      mockTwilioCreate.mockRejectedValue(new Error("Twilio auth failed"));

      const report = await runHealthCheck();
      const alertResult = await sendHealthAlerts(report);

      expect(alertResult.emailSent).toBe(true);
      expect(alertResult.smsSent).toBe(false);
    });
  });

  // ─────────────────────────────────────────────
  // Scenario 8: Health check error resilience
  // ─────────────────────────────────────────────
  describe("health check error handling", () => {
    it("should return error status when database queries fail", async () => {
      Person.countDocuments.mockRejectedValue(
        new Error("MongoDB connection lost"),
      );

      const report = await runHealthCheck();

      expect(report.status).toBe("error");
      expect(report.error).toBeDefined();
      expect(report.error.message).toContain("MongoDB connection lost");
    });
  });
});
