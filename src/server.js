'use strict';

require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { openDb } = require('./db');
const { authMiddleware } = require('./auth');
const { startChecker } = require('./checker');
const { createRouter, createWebhookHandler } = require('./routes');

const PORT = Number(process.env.PORT || 3000);

function createApp(options = {}) {
  const db = options.db || openDb(options.dbPath);
  let stripe = null;
  if (process.env.STRIPE_SECRET_KEY) {
    // Lazy require so tests without Stripe still work
    const Stripe = require('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  const app = express();

  // Stripe webhook needs raw body
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    createWebhookHandler(db, stripe)
  );

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware(db));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(createRouter(db, stripe));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, db, stripe };
}

if (require.main === module) {
  const { app, db } = createApp();
  const checker = startChecker(db);
  const server = app.listen(PORT, () => {
    console.log(`SteadyPage listening on :${PORT}`);
  });
  const shutdown = () => {
    checker.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
