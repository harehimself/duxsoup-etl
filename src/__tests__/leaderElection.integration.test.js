const LeaderElectionService = require('../services/leaderElectionService');
const SchedulerLock = require('../models/schedulerLock');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');

describe('LeaderElection (integration)', () => {
  beforeAll(async () => {
    await connect();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe('two competing instances', () => {
    let instance1;
    let instance2;

    beforeEach(() => {
      instance1 = new LeaderElectionService({
        instanceId: 'instance-1',
        ttlSeconds: 5,
        renewIntervalSeconds: 2,
      });
      instance2 = new LeaderElectionService({
        instanceId: 'instance-2',
        ttlSeconds: 5,
        renewIntervalSeconds: 2,
      });
    });

    afterEach(() => {
      instance1.stopRenewal();
      instance2.stopRenewal();
    });

    it('should allow only one instance to become leader', async () => {
      const result1 = await instance1.tryAcquire();
      const result2 = await instance2.tryAcquire();

      expect(result1).toBe(true);
      expect(instance1.isLeader).toBe(true);

      expect(result2).toBe(false);
      expect(instance2.isLeader).toBe(false);
    });

    it('should allow second instance to take over after lock expires', async () => {
      // Instance 1 acquires with a very short TTL
      const shortTtl = new LeaderElectionService({
        instanceId: 'instance-1',
        ttlSeconds: 1,
        renewIntervalSeconds: 60,
      });

      await shortTtl.tryAcquire();
      expect(shortTtl.isLeader).toBe(true);

      // Wait for the lock to expire
      // Note: MongoDB TTL monitor runs ~every 60 seconds, so we manually simulate
      // expiry by setting expiresAt in the past
      await SchedulerLock.findOneAndUpdate(
        { _id: 'scheduler-leader' },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      // Instance 2 should now be able to acquire
      const result2 = await instance2.tryAcquire();

      expect(result2).toBe(true);
      expect(instance2.isLeader).toBe(true);

      shortTtl.stopRenewal();
    });

    it('should allow re-acquire after release', async () => {
      // Instance 1 acquires and then releases
      await instance1.tryAcquire();
      expect(instance1.isLeader).toBe(true);

      await instance1.release();
      expect(instance1.isLeader).toBe(false);

      // Instance 2 can now acquire
      const result2 = await instance2.tryAcquire();
      expect(result2).toBe(true);
      expect(instance2.isLeader).toBe(true);
    });
  });

  describe('renewal', () => {
    it('should extend TTL on renewal', async () => {
      const service = new LeaderElectionService({
        instanceId: 'renew-test',
        ttlSeconds: 5,
        renewIntervalSeconds: 2,
      });

      await service.tryAcquire();
      const lockBefore = await SchedulerLock.findById('scheduler-leader').lean();

      // Small delay to ensure timestamps differ
      await new Promise((r) => setTimeout(r, 50));

      await service.renew();
      const lockAfter = await SchedulerLock.findById('scheduler-leader').lean();

      expect(lockAfter.expiresAt.getTime()).toBeGreaterThan(
        lockBefore.expiresAt.getTime(),
      );
      expect(lockAfter.lastRenewedAt.getTime()).toBeGreaterThan(
        lockBefore.lastRenewedAt.getTime(),
      );

      service.stopRenewal();
    });
  });
});
