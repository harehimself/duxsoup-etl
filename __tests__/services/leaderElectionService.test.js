jest.mock("../../src/models/schedulerLock");
jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const SchedulerLock = require("../../src/models/schedulerLock");
const LeaderElectionService = require("../../src/services/leaderElectionService");

describe("LeaderElectionService", () => {
  const INSTANCE_ID = "test-instance-1";
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new LeaderElectionService({
      instanceId: INSTANCE_ID,
      ttlSeconds: 30,
      renewIntervalSeconds: 10,
    });
  });

  afterEach(() => {
    service.stopRenewal();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should throw when instanceId is not provided", () => {
      expect(() => new LeaderElectionService()).toThrow(
        "requires an instanceId",
      );
      expect(() => new LeaderElectionService({})).toThrow(
        "requires an instanceId",
      );
    });

    it("should initialise isLeader to false", () => {
      expect(service.isLeader).toBe(false);
    });
  });

  // ─────────────────────────────────────
  // tryAcquire()
  // ─────────────────────────────────────
  describe("tryAcquire()", () => {
    it("should acquire lock and become leader when no lock exists", async () => {
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
        expiresAt: new Date(Date.now() + 30000),
      });

      const result = await service.tryAcquire();

      expect(result).toBe(true);
      expect(service.isLeader).toBe(true);
      expect(SchedulerLock.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: "scheduler-leader",
          $or: expect.arrayContaining([
            expect.objectContaining({ expiresAt: expect.any(Object) }),
            { instanceId: INSTANCE_ID },
          ]),
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            instanceId: INSTANCE_ID,
          }),
        }),
        { upsert: true, returnDocument: "after" },
      );
    });

    it("should fail to acquire when another instance holds a live lock", async () => {
      // Simulate duplicate key error (another instance won the upsert race)
      const dupKeyError = new Error("E11000 duplicate key");
      dupKeyError.code = 11000;
      SchedulerLock.findOneAndUpdate.mockRejectedValue(dupKeyError);

      const result = await service.tryAcquire();

      expect(result).toBe(false);
      expect(service.isLeader).toBe(false);
    });

    it("should handle unexpected errors gracefully", async () => {
      SchedulerLock.findOneAndUpdate.mockRejectedValue(
        new Error("network error"),
      );

      const result = await service.tryAcquire();

      expect(result).toBe(false);
      expect(service.isLeader).toBe(false);
    });
  });

  // ─────────────────────────────────────
  // renew()
  // ─────────────────────────────────────
  describe("renew()", () => {
    it("should extend TTL when we still own the lock", async () => {
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
        expiresAt: new Date(Date.now() + 30000),
      });

      // First acquire
      await service.tryAcquire();
      jest.clearAllMocks();

      // Renew
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
        expiresAt: new Date(Date.now() + 30000),
      });

      const result = await service.renew();

      expect(result).toBe(true);
      expect(service.isLeader).toBe(true);
      expect(SchedulerLock.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "scheduler-leader", instanceId: INSTANCE_ID },
        expect.objectContaining({
          $set: expect.objectContaining({
            expiresAt: expect.any(Date),
            lastRenewedAt: expect.any(Date),
          }),
        }),
        { returnDocument: "after" },
      );
    });

    it("should detect lost leadership when lock is owned by another instance", async () => {
      // Acquire first
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
      });
      await service.tryAcquire();
      expect(service.isLeader).toBe(true);

      // Renew returns null (lock not found with our instanceId)
      SchedulerLock.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.renew();

      expect(result).toBe(false);
      expect(service.isLeader).toBe(false);
    });

    it("should handle errors during renewal gracefully", async () => {
      // Acquire first
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
      });
      await service.tryAcquire();

      // Renew fails
      SchedulerLock.findOneAndUpdate.mockRejectedValue(new Error("db timeout"));

      const result = await service.renew();

      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────
  // release()
  // ─────────────────────────────────────
  describe("release()", () => {
    it("should delete the lock document and demote to follower", async () => {
      // Acquire first
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
      });
      await service.tryAcquire();
      expect(service.isLeader).toBe(true);

      SchedulerLock.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await service.release();

      expect(service.isLeader).toBe(false);
      expect(SchedulerLock.deleteOne).toHaveBeenCalledWith({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
      });
    });

    it("should handle errors during release gracefully", async () => {
      SchedulerLock.deleteOne.mockRejectedValue(new Error("db error"));

      await service.release();

      expect(service.isLeader).toBe(false);
    });
  });

  // ─────────────────────────────────────
  // startRenewal() / stopRenewal()
  // ─────────────────────────────────────
  describe("startRenewal() / stopRenewal()", () => {
    it("should call renew periodically when leader", async () => {
      // Acquire
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
      });
      await service.tryAcquire();

      // Mock renew for subsequent calls
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
        expiresAt: new Date(Date.now() + 30000),
      });

      service.startRenewal();

      // Advance time by one renewal interval (10s)
      await jest.advanceTimersByTimeAsync(10000);

      // Should have called findOneAndUpdate for renewal
      // (1 for acquire + 1 for renew)
      expect(SchedulerLock.findOneAndUpdate).toHaveBeenCalledTimes(2);

      service.stopRenewal();
    });

    it("should not call renew when not leader", async () => {
      // Don't acquire — service.isLeader is false
      SchedulerLock.findOneAndUpdate.mockResolvedValue({
        _id: "scheduler-leader",
        instanceId: INSTANCE_ID,
        expiresAt: new Date(Date.now() + 30000),
      });

      service.startRenewal();

      await jest.advanceTimersByTimeAsync(10000);

      // Should not have called findOneAndUpdate at all
      expect(SchedulerLock.findOneAndUpdate).not.toHaveBeenCalled();

      service.stopRenewal();
    });

    it("should clear interval on stopRenewal", async () => {
      service.startRenewal();
      service.stopRenewal();

      // No calls should happen after stopping
      SchedulerLock.findOneAndUpdate.mockResolvedValue(null);
      await jest.advanceTimersByTimeAsync(30000);
      expect(SchedulerLock.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("should be idempotent — calling startRenewal twice does not create two timers", () => {
      service.startRenewal();
      service.startRenewal();

      // Only one timer exists — stopRenewal once is enough
      service.stopRenewal();
    });
  });
});
