/**
 * Modul: MET Norway Locationforecast
 * Zweck: Locationforecast/2.0/compact von api.met.no in dasselbe Widget-Schema
 *        bringen, das Open-Meteo schon liefert (Lucide-Icon + wmo.*-Beschreibungs-
 *        schluessel, Tages-Hoch/Tief, 5 Folgetage). Kein API-Key; MET verlangt
 *        einen identifizierbaren User-Agent (Terms of Service).
 * Quelle: https://api.met.no/weatherapi/locationforecast/2.0/documentation
 *         https://data.met.no/
 * Abhängigkeiten: keine (reine Funktionen; Abruf macht routes/weather.js)
 */

/** Koordinaten auf vier Nachkommastellen (MET-Cache-Empfehlung). */
export function roundMetCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(4));
}

/**
 * MET-Symbol → Lucide-Name. `_day`/`_night`/`_polartwilight` und
 * `andthunder`-Varianten werden abgestreift; unbekannte Codes fallen auf `cloud`.
 */
function metSymbolBase(symbolCode) {
  const raw = String(symbolCode || '').toLowerCase();
  // Thunder zuerst: `heavyrainandthunder` waere sonst nur heavyrain.
  const thunder = raw.includes('thunder');
  const base = raw
    .replace(/_day$|_night$|_polartwilight$/i, '')
    .replace(/andthunder$/i, '');
  return { raw, base, thunder };
}

export function metSymbolIcon(symbolCode, isDay = true) {
  const { base, thunder } = metSymbolBase(symbolCode);
  if (thunder) return 'cloud-lightning';

  if (base === 'clearsky') return isDay ? 'sun' : 'moon';
  if (base === 'fair' || base === 'partlycloudy') return isDay ? 'cloud-sun' : 'cloud-moon';
  if (base === 'cloudy' || base === 'fog') return 'cloud';
  if (base === 'lightrain' || base === 'lightrainshowers') return 'cloud-drizzle';
  if (
    base === 'rain'
    || base === 'heavyrain'
    || base === 'rainshowers'
    || base === 'heavyrainshowers'
  ) return 'cloud-rain';
  if (
    base === 'sleet'
    || base === 'lightsleet'
    || base === 'heavysleet'
    || base === 'sleetshowers'
    || base === 'lightsleetshowers'
    || base === 'heavysleetshowers'
    || base === 'snow'
    || base === 'lightsnow'
    || base === 'heavysnow'
    || base === 'snowshowers'
    || base === 'lightsnowshowers'
    || base === 'heavysnowshowers'
  ) return 'cloud-snow';
  return 'cloud';
}

/**
 * MET-Symbol → bestehender `wmo.*`-Schluessel, damit alle Locales die
 * Beschreibung schon haben (kein zweites Symbol-Woerterbuch).
 */
export function metSymbolWmoKey(symbolCode) {
  const { base, thunder } = metSymbolBase(symbolCode);
  if (thunder) return 'wmo.95';

  if (base === 'clearsky') return 'wmo.0';
  if (base === 'fair') return 'wmo.1';
  if (base === 'partlycloudy') return 'wmo.2';
  if (base === 'cloudy') return 'wmo.3';
  if (base === 'fog') return 'wmo.45';
  if (base === 'lightrain' || base === 'lightrainshowers') return 'wmo.61';
  if (base === 'rain' || base === 'rainshowers') return 'wmo.63';
  if (base === 'heavyrain' || base === 'heavyrainshowers') return 'wmo.65';
  if (base.startsWith('light') && base.includes('sleet')) return 'wmo.71';
  if (base.includes('sleet')) return 'wmo.73';
  if (base === 'lightsnow' || base === 'lightsnowshowers') return 'wmo.71';
  if (base === 'snow' || base === 'snowshowers') return 'wmo.73';
  if (base === 'heavysnow' || base === 'heavysnowshowers') return 'wmo.75';
  return 'wmo.3';
}

function pickSymbol(entry) {
  const data = entry?.data ?? {};
  return data.next_1_hours?.summary?.symbol_code
    ?? data.next_6_hours?.summary?.symbol_code
    ?? data.next_12_hours?.summary?.symbol_code
    ?? null;
}

function isDaySymbol(symbolCode) {
  const s = String(symbolCode || '');
  if (/_night$/i.test(s)) return false;
  if (/_day$/i.test(s)) return true;
  return true;
}

function celsiusToDisplay(celsius, units) {
  const c = Number(celsius);
  if (!Number.isFinite(c)) return null;
  if (units === 'imperial') return Math.round((c * 9) / 5 + 32);
  return Math.round(c);
}

/** MET liefert m/s; Widget erwartet km/h (metric) bzw. mph (imperial). */
function windToDisplay(mps, units) {
  const v = Number(mps);
  if (!Number.isFinite(v)) return 0;
  if (units === 'imperial') return Math.round(v * 2.236936);
  return Math.round(v * 3.6);
}

/**
 * Compact-JSON → Widget-Payload.
 *
 * @param {object} body  Locationforecast compact response
 * @param {{ city?: string, units?: string, lat?: string|number, lon?: string|number,
 *   dateKeyFn?: (iso: string) => string }} opts
 *   `dateKeyFn` mappt einen UTC-ISO-Zeitpunkt auf YYYY-MM-DD am Wetterort
 *   (Haushaltszone). Fehlt sie, gilt der UTC-Tag.
 * @returns {object|null}
 */
export function buildMetNorwayWeather(body, opts = {}) {
  const series = body?.properties?.timeseries;
  if (!Array.isArray(series) || series.length === 0) return null;

  const units = opts.units === 'imperial' ? 'imperial' : 'metric';
  const dateKeyFn = typeof opts.dateKeyFn === 'function'
    ? opts.dateKeyFn
    : (iso) => String(iso).slice(0, 10);

  const first = series[0];
  const firstDetails = first.data?.instant?.details ?? {};
  const firstSymbol = pickSymbol(first);
  const firstIsDay = isDaySymbol(firstSymbol);
  const todayKey = dateKeyFn(first.time);

  const byDay = new Map();
  for (const entry of series) {
    const key = dateKeyFn(entry.time);
    if (!key) continue;
    const temp = entry.data?.instant?.details?.air_temperature;
    if (!Number.isFinite(Number(temp))) continue;
    let day = byDay.get(key);
    if (!day) {
      day = { temps: [], symbols: [] };
      byDay.set(key, day);
    }
    day.temps.push(Number(temp));
    const sym = pickSymbol(entry);
    if (sym) day.symbols.push(sym);
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { temps, symbols }]) => {
      // Mittagsnaeher Symbol: Eintraege sind chronologisch; nimm die Mitte.
      const mid = symbols[Math.floor(symbols.length / 2)] ?? symbols[0] ?? null;
      return {
        date,
        temp_min: celsiusToDisplay(Math.min(...temps), units),
        temp_max: celsiusToDisplay(Math.max(...temps), units),
        icon: metSymbolIcon(mid, !/_night$/i.test(String(mid || ''))),
        desc: metSymbolWmoKey(mid),
      };
    });

  const city = opts.city
    || (opts.lat != null && opts.lon != null ? `${opts.lat}, ${opts.lon}` : 'MET Norway');

  const tomorrowKey = shiftDateKey(todayKey, 1);
  const hourly = buildMetHourly(series, {
    units,
    dateKeyFn,
    hourFn: opts.hourFn,
    keepDates: new Set([todayKey, tomorrowKey].filter(Boolean)),
  });

  return {
    provider: 'met-norway',
    city,
    units,
    current: {
      temp: celsiusToDisplay(firstDetails.air_temperature, units),
      // Compact liefert kein apparent_temperature - dieselbe Zahl, kein Fake-Offset.
      feels_like: celsiusToDisplay(firstDetails.air_temperature, units),
      humidity: Number.isFinite(Number(firstDetails.relative_humidity))
        ? Math.round(Number(firstDetails.relative_humidity))
        : null,
      icon: metSymbolIcon(firstSymbol, firstIsDay),
      desc: metSymbolWmoKey(firstSymbol),
      wind_speed: windToDisplay(firstDetails.wind_speed, units),
    },
    today: days.find((d) => d.date === todayKey) ?? days[0] ?? null,
    forecast: days.filter((d) => d.date > todayKey).slice(0, 5),
    hourly,
  };
}

function shiftDateKey(dateKey, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function precipToDisplay(mm, units) {
  const v = Number(mm);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (units === 'imperial') return Math.round((v / 25.4) * 100) / 100;
  return Math.round(v * 10) / 10;
}

function wallHourFromIso(iso, dateKeyFn) {
  // MET times are UTC ISO (`…Z`). Stunde am Ort: aus dem lokalen Datumsschluessel
  // und dem Offset zwischen UTC- und Ortstag nicht rekonstruierbar ohne Zone.
  // Aufrufer kann `hourFn` liefern; sonst UTC-Stunde (Tests / Fallback).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getUTCHours();
}

/**
 * Stundenpunkte nur dort, wo MET `next_1_hours` liefert (echte Stunden-
 * Aufloesung). Spaetere 6h-Schritte entfallen. `keepDates` begrenzt auf heute
 * und morgen am Wetterort.
 */
export function buildMetHourly(series, { units = 'metric', dateKeyFn, hourFn, keepDates } = {}) {
  const keyFn = typeof dateKeyFn === 'function' ? dateKeyFn : (iso) => String(iso).slice(0, 10);
  const hourOf = typeof hourFn === 'function' ? hourFn : wallHourFromIso;
  const allow = keepDates instanceof Set ? keepDates : null;
  const out = [];
  for (const entry of series) {
    const n1 = entry?.data?.next_1_hours;
    if (!n1) continue;
    const date = keyFn(entry.time);
    if (!date || (allow && !allow.has(date))) continue;
    const details = entry.data?.instant?.details ?? {};
    const precipMm = Number(n1.details?.precipitation_amount) || 0;
    // Compact liefert oft kein Max; complete hat precipitation_amount_max.
    const precipMaxRaw = n1.details?.precipitation_amount_max;
    const precipMaxMm = Number.isFinite(Number(precipMaxRaw)) ? Number(precipMaxRaw) : null;
    const symbol = n1.summary?.symbol_code ?? '';
    const snow = /snow|sleet/i.test(symbol);
    const windDirRaw = Number(details.wind_from_direction);
    const gustRaw = details.wind_speed_of_gust;
    out.push({
      date,
      hour: hourOf(entry.time, date),
      temp: celsiusToDisplay(details.air_temperature, units),
      wind: windToDisplay(details.wind_speed, units),
      gust: Number.isFinite(Number(gustRaw)) ? windToDisplay(gustRaw, units) : null,
      windDir: Number.isFinite(windDirRaw) ? Math.round(windDirRaw) : null,
      precip: precipToDisplay(precipMm, units),
      precipMax: precipMaxMm != null ? precipToDisplay(precipMaxMm, units) : null,
      snow,
      icon: metSymbolIcon(symbol, isDaySymbol(symbol)),
    });
  }
  return out;
}

export const MET_NORWAY_FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
