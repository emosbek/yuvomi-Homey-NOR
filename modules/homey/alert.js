/**
 * Full-screen doorbell. The gateway adds this file to every Yuvomi page, so a
 * wall tablet that stays on the dashboard still hears a ring. The card sits
 * above the photo screensaver and leaves on its own after the server's timer.
 */

import { t } from '/i18n.js';
import { homeyApi } from './browser.js';

const POLL_MS = 2000;
const QUIET_MS = 15000;

function text(key, fallback) {
  try {
    const value = t(key);
    if (value && value !== key) return value;
  } catch { /* locales are not ready yet */ }
  return fallback;
}

function beep() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.frequency.value = 880;
    tone.connect(gain);
    gain.connect(ctx.destination);
    const start = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.15, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
    tone.start(start);
    tone.stop(start + 0.75);
    tone.onended = () => ctx.close();
  } catch { /* a kiosk that has never been tapped may refuse sound */ }
}

function overlay() {
  const host = document.createElement('div');
  host.id = 'homey-doorbell';
  host.style.cssText = 'position:fixed;inset:0;z-index:110000;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = [
    '.scrim{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:1.5rem;background:rgba(8,18,28,.94);color:#fff;font:500 1.25rem/1.4 system-ui,sans-serif;text-align:center}',
    'h1{margin:.75rem 0 .5rem;font-size:clamp(2.5rem,8vw,4.5rem);font-weight:650}',
    'p{margin:0 0 1.5rem;font-size:clamp(1.25rem,3vw,2rem)}',
    'button{font:inherit;font-size:1.25rem;padding:.85rem 1.6rem;border:0;border-radius:999px;background:#fff;color:#0B6E99;cursor:pointer}',
    'svg{width:4.5rem;height:4.5rem}',
  ].join('');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.setAttribute('role', 'alertdialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-labelledby', 'homey-doorbell-title');
  const title = document.createElement('h1');
  title.id = 'homey-doorbell-title';
  const body = document.createElement('p');
  body.id = 'homey-doorbell-body';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.id = 'homey-doorbell-dismiss';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M10.268 21a2 2 0 0 0 3.464 0',
    'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
  ]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  const stack = document.createElement('div');
  stack.append(svg, title, body, dismiss);
  scrim.append(stack);
  root.append(style, scrim);
  return host;
}

export function startDoorbellWatch() {
  if (typeof document === 'undefined') return;
  if (globalThis.__homeyDoorbell) return;
  globalThis.__homeyDoorbell = true;

  let host = null;
  let shownId = '';
  let hideTimer = 0;

  function hide() {
    clearTimeout(hideTimer);
    host?.remove();
    host = null;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && host) hide();
  });

  function show(alert) {
    shownId = alert.id;
    if (!host) {
      host = overlay();
      host.shadowRoot.getElementById('homey-doorbell-dismiss').addEventListener('click', hide);
      host.addEventListener('click', hide);
      document.body.append(host);
    }
    const root = host.shadowRoot;
    root.getElementById('homey-doorbell-title').textContent = alert.title
      || text('extensions.homey.alert.title', 'Noen ringer på');
    root.getElementById('homey-doorbell-body').textContent = alert.body
      || text('extensions.homey.alert.body', 'Det er noen ved døren.');
    root.getElementById('homey-doorbell-dismiss').textContent = text('extensions.homey.alert.dismiss', 'Lukk');
    clearTimeout(hideTimer);
    const wait = Math.max(0, Number(alert.remainingMs) || 0);
    hideTimer = setTimeout(hide, wait);
    beep();
  }

  async function poll() {
    try {
      const data = await homeyApi('/alert');
      const alert = data?.alert;
      if (alert && alert.id && alert.id !== shownId) show(alert);
      if (!alert) shownId = '';
      return POLL_MS;
    } catch (err) {
      if (err?.status === 401) return QUIET_MS;
      return POLL_MS;
    }
  }

  async function loop() {
    const wait = await poll();
    setTimeout(loop, wait);
  }
  loop();
}

startDoorbellWatch();
