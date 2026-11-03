/**
 * HTTP API for Kids Chores at /api/extensions/kids-chores.
 * Yuvomi does not execute this file; gateway.js (or Homey's gateway) does.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { moduleAccess, createSessionResolver } from './session.js';
import { createStore, localDateKey, localIsoWeekday } from './store.js';

const PREFIX = '/api/extensions/kids-chores';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(status, reason, message) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function sessionKey(cookie) {
  const match = String(cookie || '').match(/(?:^|;\s*)yuvomi\.sid=([^;]+)/);
  return match ? match[1] : String(cookie || '');
}

function send(res, status, payload, extra = {}) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 32_768) {
        reject(new HttpError(413, 'invalid', 'Body is too large.'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid', 'Body must be JSON.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'invalid', 'Body must be JSON.')));
  });
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') return false;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const expected = forwarded.split(',')[0].trim();
  return Boolean(expected) && host === expected;
}

function postWebhook(url, payload) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, reason: 'url' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve({ ok: false, reason: 'url' });
      return;
    }
    const body = JSON.stringify(payload);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'yuvomi-kids-chores/1.0',
      },
      timeout: 8000,
    }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.on('error', () => resolve({ ok: false, reason: 'network' }));
    req.end(body);
  });
}

function todayBundle(store, now = new Date()) {
  const settings = store.publicSettings();
  const tz = settings.timezone;
  const dateKey = localDateKey(tz, now);
  const weekday = localIsoWeekday(tz, now);
  const chores = store.listChores().filter((c) => c.active !== false && c.days.includes(weekday));
  const doneMap = store.snapshot().completions[dateKey] || {};
  const items = chores.map((c) => ({
    id: c.id,
    title: c.title,
    points: c.points,
    done: Boolean(doneMap[c.id]),
    completedAt: doneMap[c.id]?.at || null,
  }));
  const earned = items.filter((i) => i.done).reduce((sum, i) => sum + i.points, 0);
  const goal = settings.pointGoal;
  const percent = goal > 0 ? Math.min(100, Math.round((earned / goal) * 100)) : 0;
  const goalReached = earned >= goal;
  const allDone = items.length > 0 && items.every((i) => i.done);
  const open = items.filter((i) => !i.done);
  return {
    date: dateKey,
    weekday,
    settings,
    items,
    open,
    earned,
    goal,
    percent,
    goalReached,
    allDone,
    congratsMessage: settings.congratsMessage,
    progressIcon: settings.progressIcon,
    goalMeta: store.snapshot().goals[dateKey] || null,
  };
}

async function maybeFireGoal(store, session, now = new Date()) {
  const bundle = todayBundle(store, now);
  if (!bundle.goalReached) return bundle;
  const snap = store.snapshot();
  const existing = snap.goals[bundle.date];
  if (existing?.webhookSent && existing?.notified) return bundle;

  const settings = snap.settings;
  let webhookSent = existing?.webhookSent === true;
  let notified = existing?.notified === true;

  if (!webhookSent && settings.webhookUrl) {
    const result = await postWebhook(settings.webhookUrl, {
      event: 'kids_chores.goal_reached',
      module: 'kids-chores',
      date: bundle.date,
      earned: bundle.earned,
      goal: bundle.goal,
      percent: bundle.percent,
      timezone: settings.timezone,
      triggeredBy: session?.displayName || session?.id || null,
    });
    webhookSent = result.ok === true;
  }

  if (!notified && settings.notifyAdmin !== false) {
    /* Structured fields only — UI localizes the sentence + date. */
    await store.pushNotice({
      kind: 'goal',
      date: bundle.date,
      earned: bundle.earned,
      goal: bundle.goal,
    });
    notified = true;
  }

  await store.markGoal(bundle.date, { webhookSent, notified });
  return todayBundle(store, now);
}

export function createKidsChoresHandler({
  dataDir,
  yuvomiUrl = process.env.YUVOMI_INTERNAL_URL || process.env.YUVOMI_UPSTREAM || 'http://127.0.0.1:3001',
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const store = createStore(dataDir);
  const resolveSession = createSessionResolver({ yuvomiUrl, fetchImpl });
  const csrfTokens = new Map();

  function csrfFor(cookie) {
    const key = sessionKey(cookie);
    let token = csrfTokens.get(key);
    if (!token) {
      token = randomBytes(24).toString('hex');
      csrfTokens.set(key, token);
    }
    return token;
  }

  function csrfCookie(req, token) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https')
      || String(req.headers.host || '').includes('localhost') === false && false;
    const isHttps = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `kids-chores.csrf=${token}; HttpOnly; SameSite=Lax; Path=${PREFIX}; Max-Age=86400${isHttps ? '; Secure' : ''}`;
  }

  function reply(req, res, status, payload) {
    const token = csrfFor(req.headers.cookie || '');
    send(res, status, { ...payload, csrfToken: token }, { 'Set-Cookie': csrfCookie(req, token) });
  }

  async function requireSession(req) {
    let session;
    try {
      session = await resolveSession(req.headers.cookie || '');
    } catch (err) {
      throw new HttpError(err.status || 503, err.reason || 'upstream', err.message || 'Yuvomi did not answer.');
    }
    if (!session) throw new HttpError(401, 'auth', 'Sign in required.');
    const access = moduleAccess(session);
    if (access === 'none') throw new HttpError(403, 'forbidden', 'No access to Kids Chores.');
    return { session, access };
  }

  function requireCsrf(req) {
    const expected = csrfFor(req.headers.cookie || '');
    const header = req.headers['x-kids-chores-csrf'] || '';
    const cookie = cookieValue(req.headers.cookie, 'kids-chores.csrf');
    if (!safeEqual(expected, header) || !safeEqual(expected, cookie)) {
      throw new HttpError(403, 'csrf', 'Security token rejected.');
    }
    if (!originAllowed(req)) {
      throw new HttpError(403, 'origin', 'Origin rejected.');
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://local');
    const pathName = url.pathname;
    if (!pathName.startsWith(PREFIX)) {
      send(res, 404, { error: 'Not found.', reason: 'missing' });
      return;
    }
    const sub = pathName.slice(PREFIX.length) || '/';

    if (req.method === 'OPTIONS') {
      send(res, 204, {}, {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Kids-Chores-CSRF',
        'Access-Control-Max-Age': '86400',
      });
      return;
    }

    try {
      const { session, access } = await requireSession(req);

      if (req.method === 'GET' && (sub === '/' || sub === '/today')) {
        const bundle = todayBundle(store, now());
        reply(req, res, 200, {
          ...bundle,
          access,
          role: session.role,
          notices: session.role === 'admin' ? store.snapshot().notices.slice(0, 10) : [],
        });
        return;
      }

      if (req.method === 'GET' && sub === '/chores') {
        if (session.role !== 'admin') {
          throw new HttpError(403, 'forbidden', 'Admin only.');
        }
        reply(req, res, 200, {
          chores: store.listChores(),
          settings: store.publicSettings({ includeSecrets: true }),
          access,
          role: session.role,
        });
        return;
      }

      if (req.method !== 'GET') {
        if (access !== 'write') throw new HttpError(403, 'forbidden', 'Write access required.');
        requireCsrf(req);
      }

      if (req.method === 'POST' && sub === '/complete') {
        const body = await readBody(req);
        const id = String(body?.id || '');
        if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', 'Chore id is invalid.');
        let completeMeta;
        try {
          completeMeta = await store.completeChore(id, session.id, now());
        } catch (err) {
          if (err.code === 'missing') throw new HttpError(404, 'missing', err.message);
          if (err.code === 'day') throw new HttpError(400, 'day', err.message);
          throw err;
        }
        let choreWebhookSent = false;
        if (completeMeta?.newlyCompleted && completeMeta.chore?.webhookUrl) {
          const chore = completeMeta.chore;
          const settings = store.snapshot().settings;
          const result = await postWebhook(chore.webhookUrl, {
            state: 'yes',
            done: true,
          });
          choreWebhookSent = result.ok === true;
        }
        const bundle = await maybeFireGoal(store, session, now());
        reply(req, res, 200, {
          ok: true,
          ...bundle,
          choreWebhookSent,
          access,
          role: session.role,
        });
        return;
      }

      if (req.method === 'POST' && sub === '/uncomplete') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const body = await readBody(req);
        const id = String(body?.id || '');
        if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', 'Chore id is invalid.');
        await store.uncompleteChore(id, now());
        reply(req, res, 200, { ok: true, ...todayBundle(store, now()), access, role: session.role });
        return;
      }

      if (req.method === 'POST' && sub === '/reset-today') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const { resetTargets } = await store.resetToday(now());
        const settings = store.snapshot().settings;
        let resetWebhooksSent = 0;
        for (const chore of resetTargets) {
          if (!chore.resetWebhookUrl) continue;
          const result = await postWebhook(chore.resetWebhookUrl, {
            state: 'no',
            done: false,
          });
          if (result.ok) resetWebhooksSent += 1;
        }
        reply(req, res, 200, {
          ok: true,
          ...todayBundle(store, now()),
          access,
          role: session.role,
          chores: store.listChores(),
          settings: store.publicSettings({ includeSecrets: true }),
          resetWebhooksSent,
          resetWebhookTargets: resetTargets.length,
        });
        return;
      }

      if (req.method === 'POST' && sub === '/chores') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const body = await readBody(req);
        try {
          await store.addChore(body || {});
        } catch (err) {
          if (err.code === 'limit') throw new HttpError(400, 'limit', err.message);
          if (err.code === 'invalid') throw new HttpError(400, 'invalid', err.message);
          throw err;
        }
        reply(req, res, 201, { chores: store.listChores(), settings: store.publicSettings() });
        return;
      }

      if (req.method === 'PUT' && sub === '/chores/reorder') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const body = await readBody(req);
        const ids = Array.isArray(body?.ids) ? body.ids.map((id) => String(id)) : [];
        if (ids.some((id) => !ID_RE.test(id))) throw new HttpError(400, 'invalid', 'Order is invalid.');
        try {
          await store.reorderChores(ids);
        } catch (err) {
          if (err.code === 'invalid') throw new HttpError(400, 'invalid', err.message);
          throw err;
        }
        reply(req, res, 200, { chores: store.listChores(), settings: store.publicSettings() });
        return;
      }

      if (req.method === 'PUT' && sub.startsWith('/chores/')) {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const id = sub.slice('/chores/'.length);
        if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', 'Chore id is invalid.');
        const body = await readBody(req);
        try {
          await store.updateChore(id, body || {});
        } catch (err) {
          if (err.code === 'missing') throw new HttpError(404, 'missing', err.message);
          if (err.code === 'invalid') throw new HttpError(400, 'invalid', err.message);
          throw err;
        }
        reply(req, res, 200, { chores: store.listChores(), settings: store.publicSettings() });
        return;
      }

      if (req.method === 'DELETE' && sub.startsWith('/chores/')) {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const id = sub.slice('/chores/'.length);
        if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', 'Chore id is invalid.');
        await store.removeChore(id);
        reply(req, res, 200, { chores: store.listChores(), settings: store.publicSettings() });
        return;
      }

      if (req.method === 'PUT' && sub === '/settings') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const body = await readBody(req);
        try {
          await store.updateSettings(body || {});
        } catch (err) {
          if (err.code === 'invalid') throw new HttpError(400, 'invalid', err.message);
          throw err;
        }
        reply(req, res, 200, {
          settings: store.publicSettings({ includeSecrets: true }),
          chores: store.listChores(),
        });
        return;
      }

      if (req.method === 'POST' && sub === '/notices/clear') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        await store.clearNotices();
        reply(req, res, 200, { ok: true, notices: [] });
        return;
      }

      if (req.method === 'POST' && sub === '/test-webhook') {
        if (session.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admin only.');
        const settings = store.snapshot().settings;
        if (!settings.webhookUrl) throw new HttpError(400, 'webhook', 'No webhook URL configured.');
        const body = await readBody(req);
        const wantNo = String(body?.state || '').toLowerCase() === 'no'
          || body?.done === false;
        const payload = wantNo
          ? { state: 'no', done: false }
          : { state: 'yes', done: true };
        const result = await postWebhook(settings.webhookUrl, payload);
        if (!result.ok) throw new HttpError(502, 'webhook', 'Webhook did not accept the test.');
        reply(req, res, 200, { ok: true, payload });
        return;
      }

      throw new HttpError(404, 'missing', 'Not found.');
    } catch (err) {
      if (err instanceof HttpError) {
        const token = csrfFor(req.headers.cookie || '');
        send(res, err.status, {
          error: err.message,
          reason: err.reason,
          csrfToken: token,
        }, { 'Set-Cookie': csrfCookie(req, token) });
        return;
      }
      console.error('[kids-chores]', err);
      send(res, 500, { error: 'Internal error.', reason: 'internal' });
    }
  }

  return handle;
}

export function createKidsChoresServer(options) {
  return http.createServer(createKidsChoresHandler(options));
}
