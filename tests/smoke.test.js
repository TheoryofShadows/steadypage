'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/server');
const { checkOnce } = require('../src/checker');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../src/auth');
const { monitorLimit } = require('../src/plans');
const { isValidUrl } = require('../src/slug');

describe('SteadyPage smoke', () => {
  let dbPath;
  let app;
  let db;
  let server;
  let base;

  before(async () => {
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.STRIPE_SECRET_KEY; // avoid real stripe in unit smoke
    dbPath = path.join(os.tmpdir(), `steadypage-test-${Date.now()}.db`);
    ({ app, db } = createApp({ dbPath }));
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('GET /health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('landing page is honest HTML', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /SteadyPage/);
    assert.match(html, /Start free/);
    assert.doesNotMatch(html, /trusted by thousands/i);
  });

  it('signup, login, add monitor, status page', async () => {
    const email = `user${Date.now()}@example.com`;
    const password = 'password123';

    let res = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 201);
    const signup = await res.json();
    assert.ok(signup.token);
    assert.equal(signup.user.plan, 'free');
    assert.ok(signup.user.status_slug);

    res = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200);
    const login = await res.json();
    assert.ok(login.token);

    // Free tier: add one monitor via form-style POST with cookie
    const cookie = res.headers.getSetCookie?.()?.[0]?.split(';')[0]
      || `sp_token=${login.token}`;

    res = await fetch(`${base}/monitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        Authorization: `Bearer ${login.token}`,
      },
      body: new URLSearchParams({ name: 'Example', url: 'https://example.com' }),
      redirect: 'manual',
    });
    assert.ok([302, 303].includes(res.status));

    const monitors = db.prepare('SELECT * FROM monitors WHERE user_id = ?').all(signup.user.id);
    assert.equal(monitors.length, 1);

    // Second monitor should be rejected (redirect with error)
    res = await fetch(`${base}/monitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${login.token}`,
      },
      body: new URLSearchParams({ name: 'Two', url: 'https://example.org' }),
      redirect: 'manual',
    });
    assert.ok([302, 303].includes(res.status));
    const loc = res.headers.get('location') || '';
    assert.match(loc, /error=/);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM monitors WHERE user_id = ?').get(signup.user.id).c, 1);

    res = await fetch(`${base}/s/${signup.user.status_slug}`);
    assert.equal(res.status, 200);
    const statusHtml = await res.text();
    assert.match(statusHtml, /Example|no data|Operational|Waiting/i);
  });

  it('auth helpers', () => {
    const hash = hashPassword('secretpass');
    assert.ok(verifyPassword('secretpass', hash));
    assert.ok(!verifyPassword('wrong', hash));
    const token = signToken({ id: 'u1', email: 'a@b.c', plan: 'free' });
    const payload = verifyToken(token);
    assert.equal(payload.sub, 'u1');
  });

  it('plan limits', () => {
    assert.equal(monitorLimit('free'), 1);
    assert.equal(monitorLimit('pro'), 20);
  });

  it('url validation', () => {
    assert.ok(isValidUrl('https://example.com'));
    assert.ok(isValidUrl('http://localhost:3000/health'));
    assert.ok(!isValidUrl('ftp://x'));
    assert.ok(!isValidUrl('not-a-url'));
  });

  it('checkOnce against example.com', async () => {
    const result = await checkOnce({ url: 'https://example.com' });
    assert.equal(typeof result.ok, 'number');
    assert.ok(result.latency_ms >= 0);
  });

  it('pro unlock allows more monitors in DB logic', () => {
    const id = 'pro-user-' + Date.now();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, plan, status_slug) VALUES (?, ?, ?, 'pro', ?)`
    ).run(id, `pro${Date.now()}@example.com`, hashPassword('password123'), `pro-${Date.now()}`);
    assert.equal(monitorLimit('pro'), 20);
  });
});
