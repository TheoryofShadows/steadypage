'use strict';

const { randomBytes } = require('crypto');
const dns = require('dns').promises;
const net = require('net');

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

function allowLocalMonitors() {
  return process.env.ALLOW_LOCAL_MONITORS === '1';
}

function bareHost(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function isPrivateIp(ip) {
  const host = bareHost(ip);
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const parts = host.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

const BLOCKED_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.google.com',
]);

function hostBlocked(hostname) {
  const host = bareHost(hostname);
  if (!host) return true;
  if (allowLocalMonitors() && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    return false;
  }
  if (BLOCKED_NAMES.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  if (net.isIP(host) && isPrivateIp(host)) return true;
  return false;
}

function isValidUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return !hostBlocked(u.hostname);
  } catch {
    return false;
  }
}

/** True only when every resolved address is a public IP. */
async function resolvesToPublicAddress(raw) {
  let hostname;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    return false;
  }
  if (hostBlocked(hostname)) return false;
  const host = bareHost(hostname);
  if (net.isIP(host)) return !isPrivateIp(host);
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  if (!records.length) return false;
  return records.every((r) => !isPrivateIp(r.address));
}

module.exports = { makeSlug, isValidUrl, resolvesToPublicAddress, hostBlocked };
