'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { hashPassword, verifyPassword, signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('./auth');
const { makeSlug, isValidUrl } = require('./slug');
const { monitorLimit } = require('./plans');
const { layout, escapeHtml } = require('./html');

const PRO_LOOKUP = 'steadypage-pro-8';
const PRO_CENTS = 800;
const PRO_PRICE_ID = 'price_1UJkAcCJ8WGcNSoK6Hsdx8Bg';

async function resolveProPrice(stripe) {
  if (PRO_PRICE_ID) return PRO_PRICE_ID;
  try {
    const listed = await stripe.prices.list({ lookup_keys: [PRO_LOOKUP], active: true, limit: 1 });
    const hit = (listed.data || []).find((p) => p.unit_amount === PRO_CENTS);
    if (hit) return hit.id;
  } catch (err) {
    console.error('[stripe price lookup]', err.message);
  }
  return process.env.STRIPE_PRICE_PRO || '';
}

function createRouter(db, stripe) {
  const router = express.Router();
  const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'steadypage' });
  });

  router.get('/', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    const body = `
      <section class="hero">
        <h1>Know when your indie app is down.</h1>
        <p class="lead">SteadyPage runs simple HTTPS checks and gives you a public status page. No fluff, no fake testimonials — just monitors and a page your users can bookmark.</p>
        <div class="cta">
          <a class="btn" href="/signup">Start free</a>
          <a class="btn secondary" href="/login">Log in</a>
        </div>
      </section>
      <div class="grid">
        <div class="card">
          <h3>Free</h3>
          <p class="muted">$0</p>
          <ul class="pricing">
            <li>1 HTTPS monitor</li>
            <li>Check every 60 seconds</li>
            <li>Public status page</li>
          </ul>
        </div>
        <div class="card">
          <h3>Pro</h3>
          <p class="muted">$8 / month</p>
          <ul class="pricing">
            <li>Up to 20 monitors</li>
            <li>Same 60s checks</li>
            <li>Same public status page</li>
          </ul>
        </div>
      </div>
      <div class="card">
        <h3>What you get</h3>
        <p class="muted">In-process checks (GET), latency + status stored in SQLite, and <code>/s/your-slug</code> for a public page. Built for solo builders shipping small apps.</p>
      </div>`;
    res.type('html').send(layout({ title: 'Uptime + status pages', user: null, body }));
  });

  router.get('/signup', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    const err = req.query.error ? `<p class="error">${escapeHtml(req.query.error)}</p>` : '';
    const body = `
      <h1>Sign up</h1>
      <div class="card">
        ${err}
        <form class="stack" method="post" action="/signup">
          <label>Email</label>
          <input type="email" name="email" required autocomplete="email" />
          <label>Password (min 8 characters)</label>
          <input type="password" name="password" required minlength="8" autocomplete="new-password" />
          <button class="primary" type="submit">Create account</button>
        </form>
        <p class="muted">Already have an account? <a href="/login">Log in</a></p>
      </div>`;
    res.type('html').send(layout({ title: 'Sign up', user: null, body }));
  });

  router.post('/signup', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password || password.length < 8) {
      return res.redirect('/signup?error=' + encodeURIComponent('Email and password (8+ chars) required'));
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.redirect('/signup?error=' + encodeURIComponent('Email already registered'));
    }
    const id = randomUUID();
    let slug = makeSlug(email);
    // ensure unique slug
    while (db.prepare('SELECT id FROM users WHERE status_slug = ?').get(slug)) {
      slug = makeSlug(email);
    }
    db.prepare(
      `INSERT INTO users (id, email, password_hash, plan, status_slug) VALUES (?, ?, ?, 'free', ?)`
    ).run(id, email, hashPassword(password), slug);
    const user = db.prepare('SELECT id, email, plan, status_slug FROM users WHERE id = ?').get(id);
    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  });

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    const err = req.query.error ? `<p class="error">${escapeHtml(req.query.error)}</p>` : '';
    const body = `
      <h1>Log in</h1>
      <div class="card">
        ${err}
        <form class="stack" method="post" action="/login">
          <label>Email</label>
          <input type="email" name="email" required autocomplete="email" />
          <label>Password</label>
          <input type="password" name="password" required autocomplete="current-password" />
          <button class="primary" type="submit">Log in</button>
        </form>
        <p class="muted">No account? <a href="/signup">Sign up</a></p>
      </div>`;
    res.type('html').send(layout({ title: 'Log in', user: null, body }));
  });

  router.post('/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.redirect('/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    setAuthCookie(res, signToken(user));
    res.redirect('/dashboard');
  });

  router.post('/logout', (req, res) => {
    clearAuthCookie(res);
    res.redirect('/');
  });

  router.get('/dashboard', requireAuth, (req, res) => {
    const monitors = db.prepare('SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at').all(req.user.id);
    const limit = monitorLimit(req.user.plan);
    const latestStmt = db.prepare(
      `SELECT ok, status_code, latency_ms, checked_at, error FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1`
    );
    const rows = monitors.map((m) => {
      const last = latestStmt.get(m.id);
      let badge = '<span class="badge unknown">no data</span>';
      let meta = '—';
      if (last) {
        badge = last.ok
          ? '<span class="badge up">up</span>'
          : '<span class="badge down">down</span>';
        meta = `${last.latency_ms ?? '—'} ms · ${escapeHtml(last.checked_at)}${last.error ? ' · ' + escapeHtml(last.error) : ''}`;
      }
      return `<tr>
        <td>${escapeHtml(m.name)}<br><span class="muted">${escapeHtml(m.url)}</span></td>
        <td>${badge}</td>
        <td class="muted">${meta}</td>
        <td class="row-actions">
          <form method="post" action="/monitors/${m.id}/delete" onsubmit="return confirm('Remove this monitor?')">
            <button type="submit">Remove</button>
          </form>
        </td>
      </tr>`;
    }).join('');

    const canAdd = monitors.length < limit;
    const flash = req.query.upgraded === '1' ? 'Welcome to Pro — you can add up to 20 monitors.' : null;
    const err = req.query.error ? `<p class="error">${escapeHtml(req.query.error)}</p>` : '';

    const upgradeCard = req.user.plan === 'pro'
      ? `<div class="card"><p class="ok">Plan: <strong>Pro</strong> (${monitors.length}/${limit} monitors)</p></div>`
      : `<div class="card">
          <p>Plan: <strong>Free</strong> (${monitors.length}/${limit} monitor). Upgrade to Pro for up to 20 monitors.</p>
          <form method="post" action="/billing/checkout"><button class="primary" type="submit">Upgrade to Pro — $8/mo</button></form>
          <p class="muted">Stripe Checkout. Cancel anytime from your Stripe customer portal (configure in Dashboard).</p>
        </div>`;

    const addForm = canAdd
      ? `<div class="card">
          <h3>Add monitor</h3>
          ${err}
          <form class="stack" method="post" action="/monitors">
            <label>Name</label>
            <input name="name" required maxlength="80" placeholder="API" />
            <label>URL (HTTPS recommended)</label>
            <input name="url" type="url" required placeholder="https://example.com/health" />
            <button class="primary" type="submit">Add monitor</button>
          </form>
        </div>`
      : `<div class="card"><p class="muted">Monitor limit reached for your plan.${req.user.plan === 'free' ? ' Upgrade to Pro for more.' : ''}</p></div>`;

    const body = `
      <h1>Dashboard</h1>
      ${upgradeCard}
      <div class="card">
        <p>Public status page: <a href="/s/${escapeHtml(req.user.status_slug)}" target="_blank" rel="noopener">/s/${escapeHtml(req.user.status_slug)}</a></p>
      </div>
      ${addForm}
      <div class="card">
        <h3>Your monitors</h3>
        ${monitors.length === 0
          ? '<p class="muted">No monitors yet. Add one above.</p>'
          : `<table>
              <thead><tr><th>Monitor</th><th>Status</th><th>Last check</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`}
      </div>`;
    res.type('html').send(layout({ title: 'Dashboard', user: req.user, body, flash }));
  });

  router.post('/monitors', requireAuth, (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const url = String(req.body.url || '').trim();
    if (!name || !isValidUrl(url)) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Valid name and http(s) URL required'));
    }
    const count = db.prepare('SELECT COUNT(*) AS c FROM monitors WHERE user_id = ?').get(req.user.id).c;
    const limit = monitorLimit(req.user.plan);
    if (count >= limit) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Monitor limit reached for your plan'));
    }
    db.prepare(
      `INSERT INTO monitors (id, user_id, name, url) VALUES (?, ?, ?, ?)`
    ).run(randomUUID(), req.user.id, name, url);
    res.redirect('/dashboard');
  });

  router.post('/monitors/:id/delete', requireAuth, (req, res) => {
    db.prepare('DELETE FROM monitors WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.redirect('/dashboard');
  });

  router.get('/s/:slug', (req, res) => {
    const user = db.prepare('SELECT id, status_slug FROM users WHERE status_slug = ?').get(req.params.slug);
    if (!user) {
      return res.status(404).type('html').send(layout({
        title: 'Not found',
        user: req.user,
        body: '<h1>Status page not found</h1><p class="muted">That slug does not exist.</p>',
      }));
    }
    const monitors = db.prepare('SELECT * FROM monitors WHERE user_id = ? AND enabled = 1 ORDER BY name').all(user.id);
    const latestStmt = db.prepare(
      `SELECT ok, status_code, latency_ms, checked_at FROM checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1`
    );
    let allUp = true;
    let anyData = false;
    const cards = monitors.map((m) => {
      const last = latestStmt.get(m.id);
      if (!last) {
        allUp = false;
        return `<div class="card"><h3>${escapeHtml(m.name)}</h3><span class="badge unknown">no data yet</span></div>`;
      }
      anyData = true;
      if (!last.ok) allUp = false;
      return `<div class="card">
        <h3>${escapeHtml(m.name)}</h3>
        ${last.ok ? '<span class="badge up">Operational</span>' : '<span class="badge down">Down</span>'}
        <p class="muted">${last.latency_ms ?? '—'} ms · checked ${escapeHtml(last.checked_at)}</p>
      </div>`;
    }).join('');

    let summary;
    if (monitors.length === 0) {
      summary = '<p class="big muted">No monitors configured</p>';
    } else if (!anyData) {
      summary = '<p class="big muted">Waiting for first checks…</p>';
    } else if (allUp) {
      summary = '<p class="big ok">All systems operational</p>';
    } else {
      summary = '<p class="big down">Some systems are down</p>';
    }

    const body = `
      <section class="status-hero">
        <p class="muted">Public status</p>
        ${summary}
      </section>
      <div class="grid">${cards || '<p class="muted">Nothing to show yet.</p>'}</div>
      <p class="muted" style="margin-top:2rem;text-align:center">Powered by SteadyPage</p>`;
    res.type('html').send(layout({ title: `Status · ${req.params.slug}`, user: req.user, body }));
  });

  router.post('/billing/checkout', requireAuth, async (req, res) => {
    const price = stripe ? await resolveProPrice(stripe) : '';
    if (!stripe || !price) {
      return res.status(503).type('html').send(layout({
        title: 'Billing unavailable',
        user: req.user,
        body: '<h1>Billing not configured</h1><p class="muted">Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO, then restart.</p>',
      }));
    }
    try {
      let customerId = req.user.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user.email,
          metadata: { user_id: req.user.id },
        });
        customerId = customer.id;
        db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, req.user.id);
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price, quantity: 1 }],
        success_url: `${APP_URL}/dashboard?upgraded=1`,
        cancel_url: `${APP_URL}/dashboard`,
        metadata: { user_id: req.user.id },
        subscription_data: { metadata: { user_id: req.user.id } },
      });
      res.redirect(303, session.url);
    } catch (err) {
      console.error('[stripe checkout]', err.message);
      res.redirect('/dashboard?error=' + encodeURIComponent('Could not start checkout'));
    }
  });

  // JSON API helpers for tests / scripting
  router.post('/api/signup', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || password.length < 8) {
      return res.status(400).json({ error: 'Email and password (8+ chars) required' });
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const id = randomUUID();
    let slug = makeSlug(email);
    while (db.prepare('SELECT id FROM users WHERE status_slug = ?').get(slug)) slug = makeSlug(email);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, plan, status_slug) VALUES (?, ?, ?, 'free', ?)`
    ).run(id, email, hashPassword(password), slug);
    const user = db.prepare('SELECT id, email, plan, status_slug FROM users WHERE id = ?').get(id);
    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user, token });
  });

  router.post('/api/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const safe = { id: user.id, email: user.email, plan: user.plan, status_slug: user.status_slug };
    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: safe, token });
  });

  return router;
}

function createWebhookHandler(db, stripe) {
  return async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send('Webhook not configured');
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('[webhook]', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (userId) {
          db.prepare(`UPDATE users SET plan = 'pro', stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?`)
            .run(session.customer || null, userId);
        }
      }
      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        const active = sub.status === 'active' || sub.status === 'trialing';
        if (userId) {
          db.prepare(`UPDATE users SET plan = ? WHERE id = ?`).run(active ? 'pro' : 'free', userId);
        } else if (sub.customer) {
          const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(sub.customer);
          if (user) {
            db.prepare(`UPDATE users SET plan = ? WHERE id = ?`).run(active ? 'pro' : 'free', user.id);
          }
        }
      }
    } catch (err) {
      console.error('[webhook handle]', err.message);
      return res.status(500).json({ error: 'handler failed' });
    }
    res.json({ received: true });
  };
}

module.exports = { createRouter, createWebhookHandler };
