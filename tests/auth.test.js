/**
 * tests/auth.test.js
 *
 * Integration tests for POST /api/auth/register, POST /api/auth/login,
 * GET /api/auth/me, and account-lockout behaviour.
 *
 * Each test case gets a clean database (afterEach → clearTestDB) so there is
 * no state leakage between cases.  The in-memory MongoDB means these tests
 * never touch the real Atlas cluster.
 */

const request = require('supertest');
const app     = require('../app');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup');
const { MAX_ATTEMPTS } = require('../utils/accountLockout');

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(closeTestDB);

// ─── Shared test data ─────────────────────────────────────────────────────────
const validUser = {
  name:     'Test User',
  email:    'test@example.com',
  password: 'password123',
  location: 'Lagos, Nigeria',
};

// Helper: register + return the token
const registerAndGetToken = async (overrides = {}) => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ ...validUser, ...overrides });
  return res.body.token;
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('returns 201 with a token on valid registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(validUser);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.email).toBe('test@example.com');
    expect(res.body).not.toHaveProperty('password'); // never expose the password
  });

  it('returns 409 when the same email is registered twice', async () => {
    await request(app).post('/api/auth/register').send(validUser);

    const res = await request(app)
      .post('/api/auth/register')
      .send(validUser);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('returns 400 from the validator for a malformed email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, email: 'not-an-email' });

    expect(res.status).toBe(400);
    // The validator fires before the controller, so the message comes from
    // express-validator, not from the Mongoose layer.
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when password is shorter than the 6-character minimum', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, password: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/6 characters/i);
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    // Register a user so there is always someone to log in as
    await request(app).post('/api/auth/register').send(validUser);
  });

  it('returns 200 with a token on correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('returns 401 with a generic message on wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    // Must be generic — never reveal whether the email matched
    expect(res.body.message).toMatch(/invalid credentials/i);
  });

  it('returns 401 with the same generic message for a nonexistent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid credentials/i);
  });
});

// ─── Account lockout ──────────────────────────────────────────────────────────
describe('Account lockout', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(validUser);
  });

  it(`locks the account after ${MAX_ATTEMPTS} consecutive wrong-password attempts`, async () => {
    // Exhaust the allowed attempts
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: validUser.email, password: 'wrongpassword' });
    }

    // The (MAX_ATTEMPTS + 1)th attempt — even with the CORRECT password —
    // must now be rejected with 423 (account locked), not 200.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(423);
    expect(res.body.message).toMatch(/too many failed attempts/i);
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('returns the user profile with a valid token', async () => {
    const token = await registerAndGetToken();

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
    expect(res.body).not.toHaveProperty('password');
  });

  it('returns 401 when no token is supplied', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('returns 401 when a malformed / invalid token is supplied', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt');

    expect(res.status).toBe(401);
  });
});
