jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('webhookAuth middleware', () => {
  let webhookAuth;
  let req, res, next;

  beforeEach(() => {
    // Reset module cache so WEBHOOK_SECRET env var changes take effect
    jest.resetModules();
    jest.mock('../../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));

    req = {
      headers: {},
      ip: '127.0.0.1',
      path: '/api/webhook',
      method: 'POST',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
  });

  it('should pass through when WEBHOOK_SECRET is not set in development', () => {
    delete process.env.WEBHOOK_SECRET;
    process.env.NODE_ENV = 'development';
    webhookAuth = require('../../src/middleware/webhookAuth');

    webhookAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should pass through when WEBHOOK_SECRET is not set in test', () => {
    delete process.env.WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';
    webhookAuth = require('../../src/middleware/webhookAuth');

    webhookAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should reject with 403 when WEBHOOK_SECRET is not set in production', () => {
    delete process.env.WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    webhookAuth = require('../../src/middleware/webhookAuth');

    webhookAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'FORBIDDEN',
        message: 'Webhook authentication is not configured',
      }),
    );
  });

  it('should pass through when correct X-Webhook-Secret header is provided', () => {
    process.env.WEBHOOK_SECRET = 'my-secret-token';
    webhookAuth = require('../../src/middleware/webhookAuth');

    req.headers['x-webhook-secret'] = 'my-secret-token';

    webhookAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should pass through when correct Authorization Bearer header is provided', () => {
    process.env.WEBHOOK_SECRET = 'my-secret-token';
    webhookAuth = require('../../src/middleware/webhookAuth');

    req.headers['authorization'] = 'Bearer my-secret-token';

    webhookAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should pass through with valid secret in production', () => {
    process.env.WEBHOOK_SECRET = 'my-secret-token';
    process.env.NODE_ENV = 'production';
    webhookAuth = require('../../src/middleware/webhookAuth');

    req.headers['x-webhook-secret'] = 'my-secret-token';

    webhookAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should reject with 401 when secret is wrong', () => {
    process.env.WEBHOOK_SECRET = 'my-secret-token';
    webhookAuth = require('../../src/middleware/webhookAuth');

    req.headers['x-webhook-secret'] = 'wrong-secret';

    webhookAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'UNAUTHORIZED',
      }),
    );
  });

  it('should reject with 401 when no secret header is provided but env var is set', () => {
    process.env.WEBHOOK_SECRET = 'my-secret-token';
    webhookAuth = require('../../src/middleware/webhookAuth');

    webhookAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should reject with 401 when wrong secret in production', () => {
    process.env.WEBHOOK_SECRET = 'my-secret-token';
    process.env.NODE_ENV = 'production';
    webhookAuth = require('../../src/middleware/webhookAuth');

    req.headers['x-webhook-secret'] = 'wrong-secret';

    webhookAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
