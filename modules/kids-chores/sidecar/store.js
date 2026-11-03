/**
 * Kids Chores state. Never yuvomi.db.
 */

import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MAX_CHORES = 48;
const DAY_MIN = 1;
const DAY_MAX = 7;

function empty() {
  return {
    version: 1,
    settings: {
      pointGoal: 10,
      congratsMessage: 'All done for today — great work!',
      webhookUrl: null,
      notifyAdmin: true,
      timezone: 'Europe/Oslo',
      progressIcon: 'sun',
    },
    chores: [],
    /** @type {Record<string, Record<string, { at: string, by: string|number }>>} */
    completions: {},
    /** @type {Record<string, { at: string, webhookSent: boolean, notified: boolean }>} */
    goals: {},
    /** Admin-facing notices shown in the module (not core push). */
    notices: [],
  };
}

function cleanDays(days) {
  if (!Array.isArray(days)) return [1, 2, 3, 4, 5];
  const out = [...new Set(days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= DAY_MIN && d <= DAY_MAX))];
  out.sort((a, b) => a - b);
  return out.length ? out : [1, 2, 3, 4, 5];
}

function cleanChore(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  if (!title) return null;
  const points = Math.max(0, Math.min(1000, Math.round(Number(raw.points) || 0)));
  const id = typeof raw.id === 'string' && raw.id ? raw.id : randomUUID();
  return {
    id,
    title,
    points,
    days: cleanDays(raw.days),
    active: raw.active !== false,
    sort: Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : 0,
  };
}

function cleanSettings(raw, fallback) {
  const base = { ...fallback };
  if (!raw || typeof raw !== 'object') return base;
  if (raw.pointGoal !== undefined) {
    const goal = Math.round(Number(raw.pointGoal));
    if (Number.isFinite(goal)) base.pointGoal = Math.max(1, Math.min(100000, goal));
  }
  if (raw.congratsMessage !== undefined) {
    base.congratsMessage = String(raw.congratsMessage ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200)
      || fallback.congratsMessage;
  }
  if (raw.webhookUrl !== undefined) {
    const url = String(raw.webhookUrl ?? '').trim();
    if (!url) base.webhookUrl = null;
    else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad');
        if (url.length > 2000) throw new Error('bad');
        base.webhookUrl = url;
      } catch {
        /* keep previous */
      }
    }
  }
  if (raw.notifyAdmin !== undefined) base.notifyAdmin = raw.notifyAdmin !== false;
  if (raw.timezone !== undefined) {
    const tz = String(raw.timezone || '').trim();
    if (tz && tz.length <= 64) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        base.timezone = tz;
      } catch { /* keep */ }
    }
  }
  if (raw.progressIcon === 'star' || raw.progressIcon === 'sun') {
    base.progressIcon = raw.progressIcon;
  }
  return base;
}

function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
    const base = empty();
    return {
      version: 1,
      settings: cleanSettings(parsed.settings, base.settings),
      chores: Array.isArray(parsed.chores)
        ? parsed.chores.map(cleanChore).filter(Boolean).slice(0, MAX_CHORES)
        : [],
      completions: parsed.completions && typeof parsed.completions === 'object' && !Array.isArray(parsed.completions)
        ? parsed.completions
        : {},
      goals: parsed.goals && typeof parsed.goals === 'object' && !Array.isArray(parsed.goals)
        ? parsed.goals
        : {},
      notices: Array.isArray(parsed.notices) ? parsed.notices.slice(0, 40) : [],
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return empty();
    throw err;
  }
}

/** Local calendar YYYY-MM-DD in the household timezone. */
export function localDateKey(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** ISO weekday 1=Mon … 7=Sun in the household timezone. */
export function localIsoWeekday(timeZone, now = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(now);
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[weekday] || 1;
}

export function createStore(dir) {
  const file = path.join(dir, 'state.json');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* read-only mounts fail at write */ }
  let state = readState(file);
  let queue = Promise.resolve();

  function persist() {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch { /* */ }
  }

  function mutate(fn) {
    const run = queue.then(() => {
      state = fn(state) || state;
      persist();
      return state;
    });
    queue = run.then(() => {}, () => {});
    return run;
  }

  function pruneOld(current, keepDays = 14) {
    const tz = current.settings.timezone || 'Europe/Oslo';
    const today = localDateKey(tz);
    const cutoff = new Date(`${today}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const completions = { ...current.completions };
    const goals = { ...current.goals };
    for (const key of Object.keys(completions)) {
      if (key < cutoffKey) delete completions[key];
    }
    for (const key of Object.keys(goals)) {
      if (key < cutoffKey) delete goals[key];
    }
    return { ...current, completions, goals };
  }

  return {
    maxChores: MAX_CHORES,
    snapshot() {
      return {
        settings: { ...state.settings },
        chores: state.chores.map((c) => ({ ...c, days: [...c.days] })),
        completions: structuredClone(state.completions),
        goals: structuredClone(state.goals),
        notices: state.notices.map((n) => ({ ...n })),
      };
    },
    settings() {
      return { ...state.settings, webhookSet: Boolean(state.settings.webhookUrl) };
    },
    publicSettings() {
      const s = state.settings;
      return {
        pointGoal: s.pointGoal,
        congratsMessage: s.congratsMessage,
        notifyAdmin: s.notifyAdmin !== false,
        timezone: s.timezone,
        progressIcon: s.progressIcon === 'star' ? 'star' : 'sun',
        webhookSet: Boolean(s.webhookUrl),
      };
    },
    updateSettings(patch) {
      return mutate((current) => pruneOld({
        ...current,
        settings: cleanSettings(patch, current.settings),
      }));
    },
    listChores() {
      return state.chores
        .map((c) => ({ ...c, days: [...c.days] }))
        .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
    },
    addChore(input) {
      return mutate((current) => {
        if (current.chores.length >= MAX_CHORES) {
          const err = new Error('Too many chores.');
          err.code = 'limit';
          throw err;
        }
        const chore = cleanChore({ ...input, id: randomUUID(), sort: current.chores.length });
        if (!chore) {
          const err = new Error('Title is required.');
          err.code = 'invalid';
          throw err;
        }
        return pruneOld({ ...current, chores: [...current.chores, chore] });
      });
    },
    updateChore(id, input) {
      return mutate((current) => {
        const idx = current.chores.findIndex((c) => c.id === id);
        if (idx === -1) {
          const err = new Error('Chore not found.');
          err.code = 'missing';
          throw err;
        }
        const merged = cleanChore({ ...current.chores[idx], ...input, id });
        if (!merged) {
          const err = new Error('Title is required.');
          err.code = 'invalid';
          throw err;
        }
        const chores = current.chores.slice();
        chores[idx] = merged;
        return pruneOld({ ...current, chores });
      });
    },
    removeChore(id) {
      return mutate((current) => pruneOld({
        ...current,
        chores: current.chores.filter((c) => c.id !== id),
      }));
    },
    completeChore(id, userId, at = new Date()) {
      return mutate((current) => {
        const chore = current.chores.find((c) => c.id === id && c.active !== false);
        if (!chore) {
          const err = new Error('Chore not found.');
          err.code = 'missing';
          throw err;
        }
        const tz = current.settings.timezone || 'Europe/Oslo';
        const day = localIsoWeekday(tz, at);
        if (!chore.days.includes(day)) {
          const err = new Error('Not scheduled today.');
          err.code = 'day';
          throw err;
        }
        const dateKey = localDateKey(tz, at);
        const dayMap = { ...(current.completions[dateKey] || {}) };
        if (dayMap[id]) return current;
        dayMap[id] = { at: at.toISOString(), by: userId };
        return pruneOld({
          ...current,
          completions: { ...current.completions, [dateKey]: dayMap },
        });
      });
    },
    uncompleteChore(id, at = new Date()) {
      return mutate((current) => {
        const tz = current.settings.timezone || 'Europe/Oslo';
        const dateKey = localDateKey(tz, at);
        const dayMap = { ...(current.completions[dateKey] || {}) };
        if (!dayMap[id]) return current;
        delete dayMap[id];
        const completions = { ...current.completions };
        if (Object.keys(dayMap).length) completions[dateKey] = dayMap;
        else delete completions[dateKey];
        const goals = { ...current.goals };
        delete goals[dateKey];
        return pruneOld({ ...current, completions, goals });
      });
    },
    markGoal(dateKey, flags) {
      return mutate((current) => pruneOld({
        ...current,
        goals: {
          ...current.goals,
          [dateKey]: {
            at: current.goals[dateKey]?.at || new Date().toISOString(),
            webhookSent: Boolean(flags.webhookSent ?? current.goals[dateKey]?.webhookSent),
            notified: Boolean(flags.notified ?? current.goals[dateKey]?.notified),
          },
        },
      }));
    },
    pushNotice(notice) {
      return mutate((current) => pruneOld({
        ...current,
        notices: [
          {
            id: randomUUID(),
            at: new Date().toISOString(),
            ...notice,
          },
          ...current.notices,
        ].slice(0, 40),
      }));
    },
    clearNotices() {
      return mutate((current) => ({ ...current, notices: [] }));
    },
  };
}
