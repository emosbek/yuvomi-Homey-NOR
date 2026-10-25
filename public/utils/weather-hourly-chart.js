/**
 * Yr-stil Stunden-Wetterdiagramm: zwei Panels (Temp+Nedbør / Vind),
 * ~48 timer sammenhengende tidslinje, vær-ikoner og vindpiler.
 */

import { esc } from '/utils/html.js';
import {
  AXIS_GAP,
  chartGridMarkup,
  chartScales,
  chartX,
  chartY,
  niceDomain,
} from '/utils/chart.js';

/** Øvre panel (temp + nedbør). Tight side pads: short °C / mm ticks only. */
export const WEATHER_HOURLY_TEMP = Object.freeze({
  W: 720, H: 160, PAD_L: 22, PAD_R: 22, PAD_T: 28, PAD_B: 22,
});

/** Nedre panel (vind + retning). */
export const WEATHER_HOURLY_WIND = Object.freeze({
  W: 720, H: 120, PAD_L: 22, PAD_R: 22, PAD_T: 10, PAD_B: 28,
});

/**
 * @param {Array<{ date: string, hour: number, temp: number|null, wind: number, precip: number, snow?: boolean }>} hourly
 * @param {string} dateKey
 */
export function hourlyForDate(hourly, dateKey) {
  if (!Array.isArray(hourly) || !dateKey) return [];
  return hourly
    .filter((h) => h && h.date === dateKey && Number.isFinite(Number(h.hour)))
    .slice()
    .sort((a, b) => a.hour - b.hour);
}

/** Naechster Kalendertag als YYYY-MM-DD (reine UTC-Arithmetik auf dem Key). */
export function nextDateKey(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Heute + morgen, chronologisch (for ~48t Yr-visning). */
export function hourlyHorizon(hourly, todayKey) {
  if (!Array.isArray(hourly) || !todayKey) return [];
  const tomorrowKey = nextDateKey(todayKey);
  const keep = new Set([todayKey, tomorrowKey].filter(Boolean));
  return hourly
    .filter((h) => h && keep.has(h.date) && Number.isFinite(Number(h.hour)))
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.hour - b.hour;
    });
}

/**
 * Sorterte datoer i `hourly` som har minst to temperaturpunkter
 * (kan steppe mellom dem i ekspandert view).
 */
export function drawableHourlyDates(hourly) {
  if (!Array.isArray(hourly)) return [];
  const byDate = new Map();
  for (const h of hourly) {
    if (!h?.date || !Number.isFinite(Number(h.hour))) continue;
    if (!Number.isFinite(Number(h.temp))) continue;
    byDate.set(h.date, (byDate.get(h.date) || 0) + 1);
  }
  return [...byDate.entries()]
    .filter(([, n]) => n >= 2)
    .map(([date]) => date)
    .sort();
}

function dayLabelShort(dateKey, locale) {
  try {
    return new Intl.DateTimeFormat(locale || 'en', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(`${dateKey}T12:00:00`));
  } catch {
    return dateKey;
  }
}

/** Windretning 0° = nord → SVG-pil (peker dit vinden kommer fra, som Yr). */
function windArrow(x, y, deg) {
  if (!Number.isFinite(Number(deg))) return '';
  // Meteorologisk: 0 = fra nord. Pil peker med vinden (+180) eller fra?
  // Yr piler viser hvor vinden kommer fra (mot vinden). Bruk deg direkte.
  const rot = Number(deg);
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(0)})">
    <path d="M0 5 L0 -5 M0 -5 L-2.2 -2 M0 -5 L2.2 -2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
}

/**
 * SVG for ~48t: øvre temp+nedbør med ikoner, nedre vind+kast+retning.
 *
 * @param {object[]} points
 * @param {object} opts
 */
export function weatherHourlyChartMarkup(points, {
  units = 'metric',
  tempUnit = '°C',
  windUnit = 'm/s',
  precipUnit = 'mm',
  locale = 'en',
  labels = {},
} = {}) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const n = points.length;
  const temps = points.map((p) => Number(p.temp)).filter(Number.isFinite);
  if (temps.length < 2) return '';

  const winds = points.map((p) => Number(p.wind)).filter(Number.isFinite);
  const gusts = points.map((p) => Number(p.gust)).filter(Number.isFinite);
  const precips = points.map((p) => Math.max(0, Number(p.precip) || 0));
  const precipMaxes = points.map((p) => Math.max(0, Number(p.precipMax) || Number(p.precip) || 0));

  const tempGeo = WEATHER_HOURLY_TEMP;
  const windGeo = WEATHER_HOURLY_WIND;
  const tempS = chartScales(tempGeo);
  const windS = chartScales(windGeo);

  const tempDom = niceDomain(Math.min(...temps), Math.max(...temps));
  const windTop = Math.max(1, ...winds, ...gusts, 1);
  const windDom = niceDomain(0, windTop);
  const precipCeil = Math.max(0.5, ...precips, ...precipMaxes);
  const precipTop = tempS.top + (tempS.bottom - tempS.top) * 0.55;
  const precipBottom = tempS.bottom;
  const barW = Math.max(2, ((tempS.right - tempS.left) / Math.max(n, 1)) * 0.5);

  const precipBars = points.map((p, i) => {
    const amt = Math.max(0, Number(p.precip) || 0);
    const maxAmt = Math.max(amt, Number(p.precipMax) || 0);
    if (!(maxAmt > 0) && !(amt > 0)) return '';
    const x = chartX(i, n, tempGeo);
    const parts = [];
    if (maxAmt > amt) {
      const hMax = (maxAmt / precipCeil) * (precipBottom - precipTop);
      parts.push(`<rect class="weather-hourly-chart__precip-max" x="${(x - barW / 2).toFixed(1)}" y="${(precipBottom - hMax).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, hMax).toFixed(1)}" rx="1" />`);
    }
    if (amt > 0) {
      const h = (amt / precipCeil) * (precipBottom - precipTop);
      const cls = p.snow ? 'weather-hourly-chart__snow' : 'weather-hourly-chart__rain';
      parts.push(`<rect class="${cls}" x="${(x - barW / 2).toFixed(1)}" y="${(precipBottom - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="1" />`);
    }
    return parts.join('');
  }).join('');

  const tempPts = points.map((p, i) => {
    const v = Number(p.temp);
    if (!Number.isFinite(v)) return null;
    return `${chartX(i, n, tempGeo).toFixed(1)},${chartY(v, tempDom.min, tempDom.max, tempGeo).toFixed(1)}`;
  }).filter(Boolean);

  const windPts = points.map((p, i) => {
    const v = Number(p.wind);
    if (!Number.isFinite(v)) return null;
    return `${chartX(i, n, windGeo).toFixed(1)},${chartY(v, windDom.min, windDom.max, windGeo).toFixed(1)}`;
  }).filter(Boolean);

  const gustPts = points.map((p, i) => {
    const v = Number(p.gust);
    if (!Number.isFinite(v)) return null;
    return `${chartX(i, n, windGeo).toFixed(1)},${chartY(v, windDom.min, windDom.max, windGeo).toFixed(1)}`;
  }).filter(Boolean);

  // Ikoner ca. hver 3. time (maks ~16).
  const iconStep = Math.max(1, Math.round(n / 12));
  const icons = points.map((p, i) => {
    if (i % iconStep !== 0 || !p.icon) return '';
    const x = chartX(i, n, tempGeo);
    return `<foreignObject x="${(x - 9).toFixed(1)}" y="2" width="18" height="18" class="weather-hourly-chart__icon-fo">
      <div xmlns="http://www.w3.org/1999/xhtml" class="weather-hourly-chart__icon-wrap">
        <i data-lucide="${esc(p.icon)}" class="weather-hourly-chart__icon" aria-hidden="true"></i>
      </div>
    </foreignObject>`;
  }).join('');

  // Timemarkører: start, ~hver 3. time, slutt.
  const hourIdx = [];
  for (let i = 0; i < n; i += Math.max(1, Math.round(n / 16))) hourIdx.push(i);
  if (hourIdx[hourIdx.length - 1] !== n - 1) hourIdx.push(n - 1);
  const hourLabels = hourIdx.map((idx) => {
    const x = chartX(idx, n, tempGeo);
    const label = String(points[idx].hour).padStart(2, '0');
    return `<text x="${x.toFixed(1)}" y="${tempGeo.H - 6}" class="chart__axis" text-anchor="middle">${esc(label)}</text>`;
  }).join('');

  // Dagsskille + dagetiketter.
  const dayMarks = [];
  for (let i = 1; i < n; i += 1) {
    if (points[i].date !== points[i - 1].date) {
      const x = chartX(i, n, tempGeo);
      dayMarks.push(`<line class="weather-hourly-chart__day-rule" x1="${x.toFixed(1)}" y1="${tempS.top}" x2="${x.toFixed(1)}" y2="${tempS.bottom}" />`);
      dayMarks.push(`<line class="weather-hourly-chart__day-rule" x1="${x.toFixed(1)}" y1="${windS.top}" x2="${x.toFixed(1)}" y2="${windS.bottom}" />`);
    }
  }
  // Dagetikett midt i panelet kolliderer med vær-ikonene. Ved én dag står
  // datoen allerede i nav-raden over grafen - ingen SVG-etikett da. Ved flere
  // dager: etikett ved starten av hvert døgn (ikke midt), under ikon-linjen.
  const uniqueDays = [...new Set(points.map((p) => p.date))];
  const dayHeads = uniqueDays.length <= 1
    ? ''
    : uniqueDays.map((date) => {
      const idxs = points.map((p, i) => (p.date === date ? i : -1)).filter((i) => i >= 0);
      const start = idxs[0];
      if (start == null) return '';
      const x = chartX(start, n, tempGeo);
      const anchor = start === 0 ? 'start' : 'middle';
      return `<text x="${x.toFixed(1)}" y="14" class="weather-hourly-chart__day-label" text-anchor="${anchor}">${esc(dayLabelShort(date, locale))}</text>`;
    }).join('');

  const formatTemp = (v) => `${Math.round(v)}`;
  const formatWind = (v) => `${Math.round(v)}`;

  const windAxis = [windDom.max, (windDom.min + windDom.max) / 2, windDom.min].map((val) => {
    const gy = chartY(val, windDom.min, windDom.max, windGeo);
    return `<text x="${windGeo.W - windGeo.PAD_R + AXIS_GAP}" y="${gy.toFixed(1)}" class="chart__axis chart__axis--y weather-hourly-chart__wind-axis" text-anchor="start">${esc(formatWind(val))}</text>`;
  }).join('');

  const precipAxisMax = Math.ceil(precipCeil);
  const precipAxis = `<text x="${tempGeo.W - tempGeo.PAD_R + AXIS_GAP}" y="${precipTop.toFixed(1)}" class="chart__axis chart__axis--y weather-hourly-chart__precip-axis" text-anchor="start">${esc(String(precipAxisMax))}</text>
    <text x="${tempGeo.W - tempGeo.PAD_R + AXIS_GAP}" y="${precipBottom.toFixed(1)}" class="chart__axis chart__axis--y weather-hourly-chart__precip-axis" text-anchor="start">0</text>`;

  const arrowY = windGeo.H - 12;
  const arrows = points.map((p, i) => {
    if (i % iconStep !== 0) return '';
    return windArrow(chartX(i, n, windGeo), arrowY, p.windDir);
  }).join('');

  const hasGust = gustPts.length >= 2;
  const hasPrecipMax = precipMaxes.some((v, i) => v > precips[i]);

  const legend = `
    <ul class="weather-hourly__legend" aria-hidden="true">
      <li class="weather-hourly__legend-item weather-hourly__legend-item--temp">${esc(labels.temp || tempUnit)}</li>
      <li class="weather-hourly__legend-item weather-hourly__legend-item--precip">${esc(labels.precip || precipUnit)}</li>
      ${hasPrecipMax ? `<li class="weather-hourly__legend-item weather-hourly__legend-item--precip-max">${esc(labels.precipMax || labels.precip || precipUnit)}</li>` : ''}
      <li class="weather-hourly__legend-item weather-hourly__legend-item--wind">${esc(labels.wind || windUnit)}</li>
      ${hasGust ? `<li class="weather-hourly__legend-item weather-hourly__legend-item--gust">${esc(labels.gust || windUnit)}</li>` : ''}
    </ul>`;

  return `
    <div class="weather-hourly-chart-stack">
      <svg class="weather-hourly-chart weather-hourly-chart--temp" viewBox="0 0 ${tempGeo.W} ${tempGeo.H}" role="img" aria-hidden="true" focusable="false">
        ${dayHeads}
        ${chartGridMarkup(tempDom.min, tempDom.max, (v) => formatTemp(v), tempGeo, tempDom.steps, { unit: '' })}
        ${dayMarks.filter((_, i) => i % 2 === 0).join('')}
        <g class="weather-hourly-chart__precip">${precipBars}</g>
        <polyline class="weather-hourly-chart__temp" fill="none" points="${tempPts.join(' ')}" vector-effect="non-scaling-stroke" />
        ${icons}
        ${hourLabels}
        ${precipAxis}
      </svg>
      <svg class="weather-hourly-chart weather-hourly-chart--wind" viewBox="0 0 ${windGeo.W} ${windGeo.H}" role="img" aria-hidden="true" focusable="false">
        ${chartGridMarkup(windDom.min, windDom.max, (v) => formatWind(v), windGeo, windDom.steps, { unit: '' })}
        ${dayMarks.filter((_, i) => i % 2 === 1).join('')}
        ${hasGust ? `<polyline class="weather-hourly-chart__gust" fill="none" points="${gustPts.join(' ')}" vector-effect="non-scaling-stroke" />` : ''}
        <polyline class="weather-hourly-chart__wind" fill="none" points="${windPts.join(' ')}" vector-effect="non-scaling-stroke" />
        <g class="weather-hourly-chart__arrows" style="color:var(--color-text-secondary)">${arrows}</g>
        ${windAxis}
      </svg>
      ${legend}
    </div>`;
}
