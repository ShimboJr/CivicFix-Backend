/**
 * tests/issues.test.js
 *
 * Integration tests for the /api/issues routes.
 *
 * Image uploads are deliberately NOT tested here — doing so would hit the real
 * Cloudinary API (slow, costs real quota, leaves orphaned assets).  A good
 * future step would be to mock the Cloudinary uploader layer (e.g. with
 * jest.mock('../config/cloudinary')) so upload-specific behaviour can be
 * exercised without side-effects.
 */

const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../app');
const Category = require('../models/Category');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup');

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(closeTestDB);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const validUser = {
  name:     'Issue Tester',
  email:    'issuer@example.com',
  password: 'password123',
  location: 'Abuja, Nigeria',
};

const secondUser = {
  name:     'Other User',
  email:    'other@example.com',
  password: 'password456',
  location: 'Lagos, Nigeria',
};

/** Register a user and return { token, userId } */
const registerUser = async (userData = validUser) => {
  const res = await request(app)
    .post('/api/auth/register')
    .send(userData);
  return { token: res.body.token, userId: res.body._id };
};

/**
 * Build a valid issue payload.
 * location is JSON-stringified exactly as the real ReportIssue.jsx frontend
 * does via FormData.append('location', JSON.stringify({...})).
 */
const buildIssuePayload = (categoryId, overrides = {}) => ({
  title:       'Test pothole on main road',
  description: 'There is a large pothole that is causing accidents.',
  category:    categoryId.toString(),
  severity:    'High',
  location:    JSON.stringify({
    address:   'Ladoke Akintola University of Technology, Ogbomoso',
    latitude:  8.1536,
    longitude: 4.2453,
  }),
  ...overrides,
});

// ─── POST /api/issues — authentication guard ──────────────────────────────────
describe('POST /api/issues — auth guard', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).post('/api/issues').send({});
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/issues — create issue ─────────────────────────────────────────
describe('POST /api/issues — create', () => {
  let token;
  let category;

  beforeEach(async () => {
    ({ token } = await registerUser());
    // Create a real category in the in-memory DB — the validator requires a
    // valid Mongo ObjectId that actually exists in the categories collection.
    category = await Category.create({ name: 'Roads & Potholes', icon: 'bi-road' });
  });

  it('creates an issue and returns 201 with the populated issue', async () => {
    const res = await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${token}`)
      // Send as multipart (matching the real frontend) but without an image file
      .field('title',       'Test pothole on main road')
      .field('description', 'There is a large pothole that is causing accidents.')
      .field('category',    category._id.toString())
      .field('severity',    'High')
      .field('location',    JSON.stringify({
        address:   'Ladoke Akintola University of Technology, Ogbomoso',
        latitude:  8.1536,
        longitude: 4.2453,
      }));

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('issueId');
    expect(res.body.title).toBe('Test pothole on main road');
    expect(res.body.location.address).toBe('Ladoke Akintola University of Technology, Ogbomoso');
    expect(res.body.images).toEqual([]); // no images were attached
  });

  it('returns 400 from the validator when title is missing', async () => {
    const res = await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${token}`)
      .field('description', 'Some description')
      .field('category',    category._id.toString())
      .field('severity',    'Medium')
      .field('location',    JSON.stringify({ address: 'Somewhere', latitude: 0, longitude: 0 }));
    // title is intentionally omitted

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title is required/i);
  });

  it('returns 400 when title exceeds the 200-character maximum', async () => {
    const res = await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${token}`)
      .field('title',       'A'.repeat(201))
      .field('description', 'Some description')
      .field('category',    category._id.toString())
      .field('severity',    'Medium')
      .field('location',    JSON.stringify({ address: 'Somewhere', latitude: 0, longitude: 0 }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/200 characters/i);
  });

  it('returns 400 when location address is missing', async () => {
    const res = await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${token}`)
      .field('title',       'Valid title')
      .field('description', 'Valid description')
      .field('category',    category._id.toString())
      .field('severity',    'Low')
      .field('location',    JSON.stringify({ address: '', latitude: 0, longitude: 0 }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/location address is required/i);
  });
});

// ─── GET /api/issues — public list ───────────────────────────────────────────
describe('GET /api/issues', () => {
  it('returns a paginated list without requiring authentication', async () => {
    const res = await request(app).get('/api/issues');

    expect(res.status).toBe(200);
    // Response shape: { issues, total, page, pages }
    expect(res.body).toHaveProperty('issues');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });
});

// ─── GET /api/issues/:id ──────────────────────────────────────────────────────
describe('GET /api/issues/:id', () => {
  it('returns 404 with a clean message for a well-formed but nonexistent ObjectId', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/api/issues/${fakeId}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
    // Must NOT be a raw Mongoose CastError stack dump
    expect(res.body.message).not.toMatch(/CastError/i);
  });

  it('returns 404 (not a CastError crash) for a malformed id like "null"', async () => {
    const res = await request(app).get('/api/issues/null');
    expect(res.status).toBe(404);
    expect(res.body.message).not.toMatch(/CastError/i);
  });

  it('returns 404 for a short malformed id like "abc"', async () => {
    const res = await request(app).get('/api/issues/abc');
    expect(res.status).toBe(404);
    expect(res.body.message).not.toMatch(/CastError/i);
  });
});

// ─── GET /api/issues/my-issues — per-user filter ─────────────────────────────
describe('GET /api/issues/my-issues', () => {
  it('returns only the issues created by the authenticated user', async () => {
    // Create two users and a category
    const { token: tokenA } = await registerUser(validUser);
    const { token: tokenB } = await registerUser(secondUser);
    const category = await Category.create({ name: 'Electricity', icon: 'bi-lightning' });

    // User A creates one issue, User B creates another
    await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('title',       'User A issue')
      .field('description', 'Desc A')
      .field('category',    category._id.toString())
      .field('severity',    'Low')
      .field('location',    JSON.stringify({ address: 'Addr A', latitude: 0, longitude: 0 }));

    await request(app)
      .post('/api/issues')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('title',       'User B issue')
      .field('description', 'Desc B')
      .field('category',    category._id.toString())
      .field('severity',    'Low')
      .field('location',    JSON.stringify({ address: 'Addr B', latitude: 0, longitude: 0 }));

    // User A should only see their own issue
    const res = await request(app)
      .get('/api/issues/my-issues')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    expect(res.body.issues[0].title).toBe('User A issue');
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/issues/my-issues');
    expect(res.status).toBe(401);
  });
});
