import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetHourly,
  buildMetNorwayWeather,
  metSymbolIcon,
  metSymbolWmoKey,
  roundMetCoord,
} from '../server/services/met-norway-weather.js';

test('roundMetCoord: four decimals, rejects non-finite', () => {
  assert.equal(roundMetCoord('59.912345'), 59.9123);
  assert.equal(roundMetCoord(10.75222), 10.7522);
  assert.equal(roundMetCoord('nope'), null);
});

test('metSymbolIcon: day/night and rain/snow/thunder families', () => {
  assert.equal(metSymbolIcon('clearsky_day', true), 'sun');
  assert.equal(metSymbolIcon('clearsky_night', false), 'moon');
  assert.equal(metSymbolIcon('partlycloudy_day'), 'cloud-sun');
  assert.equal(metSymbolIcon('rain'), 'cloud-rain');
  assert.equal(metSymbolIcon('lightrainshowers_day'), 'cloud-drizzle');
  assert.equal(metSymbolIcon('heavysnow'), 'cloud-snow');
  assert.equal(metSymbolIcon('heavyrainandthunder'), 'cloud-lightning');
  assert.equal(metSymbolIcon('unknown_thing'), 'cloud');
});

test('metSymbolWmoKey: maps onto existing wmo.* keys', () => {
  assert.equal(metSymbolWmoKey('clearsky_day'), 'wmo.0');
  assert.equal(metSymbolWmoKey('cloudy'), 'wmo.3');
  assert.equal(metSymbolWmoKey('heavyrain'), 'wmo.65');
  assert.equal(metSymbolWmoKey('rainandthunder'), 'wmo.95');
});

const SAMPLE = {
  properties: {
    meta: { updated_at: '2026-10-24T18:00:00Z' },
    timeseries: [
      {
        time: '2026-10-24T12:00:00Z',
        data: {
          instant: { details: { air_temperature: 10.4, relative_humidity: 86.6, wind_speed: 5 } },
          next_1_hours: { summary: { symbol_code: 'rain' } },
        },
      },
      {
        time: '2026-10-24T18:00:00Z',
        data: {
          instant: { details: { air_temperature: 8.1, relative_humidity: 90, wind_speed: 4 } },
          next_1_hours: { summary: { symbol_code: 'cloudy' } },
        },
      },
      {
        time: '2026-10-25T12:00:00Z',
        data: {
          instant: { details: { air_temperature: 12.0, relative_humidity: 70, wind_speed: 3 } },
          next_6_hours: { summary: { symbol_code: 'fair_day' } },
        },
      },
      {
        time: '2026-10-26T12:00:00Z',
        data: {
          instant: { details: { air_temperature: 7.0, relative_humidity: 80, wind_speed: 2 } },
          next_6_hours: { summary: { symbol_code: 'snow' } },
        },
      },
    ],
  },
};

test('buildMetNorwayWeather: current + today range + forecast days', () => {
  const data = buildMetNorwayWeather(SAMPLE, {
    city: 'Oslo',
    units: 'metric',
    dateKeyFn: (iso) => iso.slice(0, 10),
  });
  assert.equal(data.provider, 'met-norway');
  assert.equal(data.city, 'Oslo');
  assert.equal(data.current.temp, 10);
  assert.equal(data.current.icon, 'cloud-rain');
  assert.equal(data.current.desc, 'wmo.63');
  assert.equal(data.current.wind_speed, 18); // 5 m/s → km/h
  assert.equal(data.today.date, '2026-10-24');
  assert.equal(data.today.temp_min, 8);
  assert.equal(data.today.temp_max, 10);
  assert.deepEqual(data.forecast.map((d) => d.date), ['2026-10-25', '2026-10-26']);
  assert.equal(data.forecast[1].icon, 'cloud-snow');
});

test('buildMetNorwayWeather: imperial converts °C and m/s', () => {
  const data = buildMetNorwayWeather(SAMPLE, { units: 'imperial', city: 'Oslo' });
  assert.equal(data.current.temp, 51); // 10.4°C → °F
  assert.equal(data.current.wind_speed, 11); // 5 m/s → mph
});

test('buildMetNorwayWeather: hourly for today+tomorrow with icon and windDir', () => {
  const rich = {
    properties: {
      timeseries: [
        {
          time: '2026-10-24T12:00:00Z',
          data: {
            instant: {
              details: {
                air_temperature: 10,
                wind_speed: 5,
                wind_from_direction: 220,
                wind_speed_of_gust: 8,
              },
            },
            next_1_hours: {
              summary: { symbol_code: 'rain' },
              details: { precipitation_amount: 1.2, precipitation_amount_max: 2.4 },
            },
          },
        },
        {
          time: '2026-10-24T13:00:00Z',
          data: {
            instant: {
              details: {
                air_temperature: 9.5,
                wind_speed: 4,
                wind_from_direction: 200,
              },
            },
            next_1_hours: {
              summary: { symbol_code: 'cloudy' },
              details: { precipitation_amount: 0 },
            },
          },
        },
        {
          time: '2026-10-25T08:00:00Z',
          data: {
            instant: { details: { air_temperature: 7, wind_speed: 3, wind_from_direction: 180 } },
            next_1_hours: {
              summary: { symbol_code: 'fair_day' },
              details: { precipitation_amount: 0 },
            },
          },
        },
        {
          time: '2026-10-26T08:00:00Z',
          data: {
            instant: { details: { air_temperature: 5, wind_speed: 2 } },
            next_1_hours: {
              summary: { symbol_code: 'snow' },
              details: { precipitation_amount: 0.5 },
            },
          },
        },
      ],
    },
  };
  const data = buildMetNorwayWeather(rich, {
    city: 'Oslo',
    units: 'metric',
    dateKeyFn: (iso) => iso.slice(0, 10),
    hourFn: (iso) => Number(iso.slice(11, 13)),
  });
  assert.ok(Array.isArray(data.hourly));
  assert.equal(data.hourly.length, 4); // heute + Folgetage mit next_1_hours
  assert.equal(data.hourly[0].icon, 'cloud-rain');
  assert.equal(data.hourly[0].windDir, 220);
  assert.equal(data.hourly[0].gust, 29); // 8 m/s → km/h
  assert.equal(data.hourly[0].precip, 1.2);
  assert.equal(data.hourly[0].precipMax, 2.4);
  assert.equal(data.hourly[2].date, '2026-10-25');
  assert.equal(data.hourly[3].date, '2026-10-26');
});

test('buildMetHourly: skips entries without next_1_hours', () => {
  const series = [
    {
      time: '2026-10-24T12:00:00Z',
      data: {
        instant: { details: { air_temperature: 10, wind_speed: 1 } },
        next_6_hours: { summary: { symbol_code: 'cloudy' } },
      },
    },
  ];
  assert.deepEqual(buildMetHourly(series, { keepDates: new Set(['2026-10-24']) }), []);
});
