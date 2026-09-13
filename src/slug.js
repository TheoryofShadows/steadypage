'use strict';

const { randomBytes } = require('crypto');

function makeSlug(email) {
  const base = String(email || 'user')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'site';
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

function isValidUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

module.exports = { makeSlug, isValidUrl };
