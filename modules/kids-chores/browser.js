import { t } from '/i18n.js';

const API = '/api/extensions/kids-chores';

export const WEEKDAYS = [
  { day: 1, key: 'day.mon' },
  { day: 2, key: 'day.tue' },
  { day: 3, key: 'day.wed' },
  { day: 4, key: 'day.thu' },
  { day: 5, key: 'day.fri' },
  { day: 6, key: 'day.sat' },
  { day: 7, key: 'day.sun' },
];

export function reasonMessage(reason) {
  if (reason) {
    const key = `extensions.kids-chores.reason.${reason}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return t('extensions.kids-chores.reason.invalid');
}

export async function choresApi(path, { method = 'GET', body, signal, csrf } = {}) {
  const send = async (token) => {
    const response = await fetch(`${API}${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Kids-Chores-CSRF': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  let { response, data } = await send(csrf);
  if (response.status === 403 && data?.reason === 'csrf' && data.csrfToken && data.csrfToken !== csrf) {
    ({ response, data } = await send(data.csrfToken));
  }
  if (!response.ok) {
    const error = new Error(reasonMessage(data?.reason));
    error.status = response.status;
    error.reason = data?.reason;
    error.csrfToken = data?.csrfToken;
    throw error;
  }
  return data;
}

/** SVG sun/star with solid fill for `percent` (0–100). */
export function progressMark({ percent = 0, icon = 'sun', size = 72 } = {}) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const reached = p >= 100;
  const clipId = `kc-fill-${Math.random().toString(36).slice(2, 9)}`;
  const fillH = (p / 100) * size;
  const y = size - fillH;
  const stroke = reached ? 'var(--kc-mark-done, #EA580C)' : 'var(--kc-mark-stroke, #C4A484)';
  const fill = reached ? 'var(--kc-mark-done, #EA580C)' : 'var(--kc-mark-fill, #FDBA74)';

  const sunPath = `M${size / 2} ${size * 0.18}
    C${size * 0.68} ${size * 0.18} ${size * 0.82} ${size * 0.32} ${size * 0.82} ${size / 2}
    C${size * 0.82} ${size * 0.68} ${size * 0.68} ${size * 0.82} ${size / 2} ${size * 0.82}
    C${size * 0.32} ${size * 0.82} ${size * 0.18} ${size * 0.68} ${size * 0.18} ${size / 2}
    C${size * 0.18} ${size * 0.32} ${size * 0.32} ${size * 0.18} ${size / 2} ${size * 0.18}Z`;

  const starPath = `M${size / 2} ${size * 0.08}
    L${size * 0.61} ${size * 0.38}
    L${size * 0.92} ${size * 0.40}
    L${size * 0.68} ${size * 0.60}
    L${size * 0.76} ${size * 0.90}
    L${size / 2} ${size * 0.74}
    L${size * 0.24} ${size * 0.90}
    L${size * 0.32} ${size * 0.60}
    L${size * 0.08} ${size * 0.40}
    L${size * 0.39} ${size * 0.38}Z`;

  const shape = icon === 'star' ? starPath : sunPath;
  const rays = icon === 'sun'
    ? `<g stroke="${stroke}" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.85">
        <line x1="${size / 2}" y1="4" x2="${size / 2}" y2="${size * 0.14}"/>
        <line x1="${size / 2}" y1="${size * 0.86}" x2="${size / 2}" y2="${size - 4}"/>
        <line x1="4" y1="${size / 2}" x2="${size * 0.14}" y2="${size / 2}"/>
        <line x1="${size * 0.86}" y1="${size / 2}" x2="${size - 4}" y2="${size / 2}"/>
        <line x1="${size * 0.18}" y1="${size * 0.18}" x2="${size * 0.28}" y2="${size * 0.28}"/>
        <line x1="${size * 0.72}" y1="${size * 0.72}" x2="${size * 0.82}" y2="${size * 0.82}"/>
        <line x1="${size * 0.82}" y1="${size * 0.18}" x2="${size * 0.72}" y2="${size * 0.28}"/>
        <line x1="${size * 0.28}" y1="${size * 0.72}" x2="${size * 0.18}" y2="${size * 0.82}"/>
      </g>`
    : '';

  return `<svg class="kc-progress-mark" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs>
      <clipPath id="${clipId}">
        <rect x="0" y="${y}" width="${size}" height="${fillH}"/>
      </clipPath>
    </defs>
    ${rays}
    <path d="${shape}" fill="none" stroke="${stroke}" stroke-width="2.5"/>
    <path d="${shape}" fill="${fill}" clip-path="url(#${clipId})"/>
  </svg>`;
}
