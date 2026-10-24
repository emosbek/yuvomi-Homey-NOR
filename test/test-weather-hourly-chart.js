import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawableHourlyDates,
  hourlyForDate,
  hourlyHorizon,
  nextDateKey,
  weatherHourlyChartMarkup,
} from '../public/utils/weather-hourly-chart.js';

const HOURLY = [
  { date: '2026-10-25', hour: 22, temp: 8, wind: 12, precip: 0.4, icon: 'cloud-rain', windDir: 200 },
  { date: '2026-10-25', hour: 23, temp: 7, wind: 14, precip: 1.2, icon: 'cloud-rain', windDir: 210, gust: 22 },
  { date: '2026-10-26', hour: 0, temp: 6, wind: 10, precip: 0, icon: 'cloud', windDir: 180, gust: 18 },
  { date: '2026-10-26', hour: 1, temp: 6, wind: 9, precip: 0, icon: 'cloud-moon', windDir: 170, gust: 16 },
  { date: '2026-10-27', hour: 12, temp: 11, wind: 5, precip: 0, icon: 'sun' },
];

test('nextDateKey advances calendar day', () => {
  assert.equal(nextDateKey('2026-10-25'), '2026-10-26');
  assert.equal(nextDateKey('2026-12-31'), '2027-01-01');
  assert.equal(nextDateKey('bad'), null);
});

test('hourlyForDate filters and sorts one day', () => {
  const pts = hourlyForDate(HOURLY, '2026-10-25');
  assert.deepEqual(pts.map((p) => p.hour), [22, 23]);
});

test('hourlyHorizon keeps today+tomorrow only', () => {
  const pts = hourlyHorizon(HOURLY, '2026-10-25');
  assert.deepEqual(pts.map((p) => `${p.date}T${p.hour}`), [
    '2026-10-25T22',
    '2026-10-25T23',
    '2026-10-26T0',
    '2026-10-26T1',
  ]);
});

test('weatherHourlyChartMarkup: two panes, temp line, wind, legend', () => {
  const html = weatherHourlyChartMarkup(hourlyHorizon(HOURLY, '2026-10-25'), {
    locale: 'nb',
    labels: {
      temp: 'Temperatur',
      precip: 'Nedbør',
      wind: 'Vind',
      gust: 'Vindkast',
    },
  });
  assert.match(html, /weather-hourly-chart-stack/);
  assert.match(html, /weather-hourly-chart--temp/);
  assert.match(html, /weather-hourly-chart--wind/);
  assert.match(html, /weather-hourly-chart__temp/);
  assert.match(html, /weather-hourly-chart__wind/);
  assert.match(html, /weather-hourly-chart__gust/);
  assert.match(html, /weather-hourly-chart__rain/);
  assert.match(html, /data-lucide="cloud-rain"/);
  assert.match(html, /Temperatur/);
  assert.match(html, /Vindkast/);
});

test('weatherHourlyChartMarkup: needs at least two temps', () => {
  assert.equal(weatherHourlyChartMarkup([{ date: '2026-10-25', hour: 1, temp: 5, wind: 1, precip: 0 }]), '');
  assert.equal(weatherHourlyChartMarkup([]), '');
});

test('drawableHourlyDates: only days with at least two temps', () => {
  assert.deepEqual(drawableHourlyDates(HOURLY), ['2026-10-25', '2026-10-26']);
  assert.deepEqual(drawableHourlyDates([
    { date: '2026-10-25', hour: 1, temp: 5 },
    { date: '2026-10-26', hour: 1, temp: 6 },
    { date: '2026-10-26', hour: 2, temp: 7 },
  ]), ['2026-10-26']);
});
