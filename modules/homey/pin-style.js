/**
 * Shared pin presentation helpers (no DOM, no i18n).
 * Used by the Homey page, the Overview widget, and the sidecar.
 */

export const ICON_CHOICES = [
  'house',
  'lightbulb',
  'thermometer',
  'droplet',
  'volume-2',
  'speaker',
  'flame',
  'heater',
  'fan',
  'plug',
  'lock',
  'sun',
  'moon',
  'activity',
  'gauge',
  'wind',
  'bell',
  'blinds',
  'tv',
  'power',
  'music',
  'radio',
  'wifi',
  'cloud-sun',
  'snowflake',
  'workflow',
  'webhook',
  'circle',
];

const ICON_RE = /^[a-z0-9-]{1,40}$/;
const ICON_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function cleanIconName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!name) return '';
  return ICON_RE.test(name) ? name : '';
}

export function cleanHomeyIconId(value) {
  const id = String(value ?? '').trim();
  return ICON_ID_RE.test(id) ? id : '';
}

/** Extract Homey's `/api/icon/<id>` id from an iconObj. */
export function iconIdFromObj(iconObj) {
  if (!iconObj || typeof iconObj !== 'object' || Array.isArray(iconObj)) return '';
  const url = typeof iconObj.url === 'string' ? iconObj.url.trim() : '';
  const fromUrl = url.match(/^\/api\/icon\/([A-Za-z0-9_-]{1,80})$/);
  if (fromUrl) return fromUrl[1];
  return cleanHomeyIconId(iconObj.id);
}

export function deviceClassIcon(deviceClass) {
  return {
    light: 'lightbulb',
    socket: 'plug',
    thermostat: 'thermometer',
    heater: 'heater',
    lock: 'lock',
    windowcoverings: 'blinds',
    speaker: 'speaker',
    fan: 'fan',
    doorbell: 'bell',
    sensor: 'activity',
    tv: 'tv',
    button: 'circle',
    amplifier: 'volume-2',
    homealarm: 'bell',
  }[deviceClass] || '';
}

export function suggestIcon(capabilityId, deviceClass, kind) {
  if (kind === 'flow') return 'workflow';
  if (kind === 'webhook') return 'webhook';
  const id = String(capabilityId || '');
  if (id === 'measure_temperature' || id.startsWith('measure_temperature.')) return 'thermometer';
  if (id === 'measure_humidity' || id.startsWith('measure_humidity.')) return 'droplet';
  if (id === 'measure_co2' || id.startsWith('measure_co2.')) return 'wind';
  if (id === 'measure_noise' || id.startsWith('measure_noise.')) return 'volume-2';
  if (id === 'measure_luminance' || id.startsWith('measure_luminance.')) return 'sun';
  if (id === 'measure_pressure' || id.startsWith('measure_pressure.')) return 'gauge';
  if (id === 'measure_power' || id.startsWith('measure_power.')) return 'plug';
  if (id.startsWith('alarm_')) return 'bell';
  if (id === 'onoff' || id.startsWith('onoff.')) {
    return deviceClassIcon(deviceClass) || 'power';
  }
  if (id === 'dim' || id.startsWith('dim.')) return deviceClassIcon(deviceClass) || 'lightbulb';
  if (id === 'volume_set' || id.startsWith('volume_') || id === 'speaker_playing') return 'volume-2';
  if (id === 'target_temperature' || id.startsWith('target_temperature')) {
    return deviceClassIcon(deviceClass) || 'thermometer';
  }
  return deviceClassIcon(deviceClass) || 'circle';
}

export function isDisplayMode(pin) {
  return pin?.mode === 'display' || pin?.mode === 'read';
}

export function usesHomeyLabel(pin) {
  return pin?.labelMode !== 'custom';
}

export function usesHomeyIcon(pin) {
  return pin?.iconMode !== 'custom';
}

export function formatNumericPinValue(pin) {
  const value = pin?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const id = String(pin.capabilityId || '');
  const units = pin.units ? ` ${pin.units}` : '';
  if (id === 'dim' || id.startsWith('dim.')) {
    if (value >= 0 && value <= 1) return `${Math.round(value * 100)} %`;
  }
  if (id.includes('temperature') || id.includes('humidity') || id.includes('pressure')) {
    const rounded = Math.round(value * 10) / 10;
    return `${rounded}${units}`;
  }
  if (Number.isInteger(value)) return `${value}${units}`;
  return `${Math.round(value * 100) / 100}${units}`;
}

export function formatReading(reading) {
  if (!reading || typeof reading.value !== 'number' || !Number.isFinite(reading.value)) return null;
  const units = reading.units ? ` ${reading.units}` : '';
  const id = String(reading.capabilityId || '');
  if (id.includes('temperature') || id.includes('humidity') || id.includes('pressure')) {
    return `${Math.round(reading.value * 10) / 10}${units}`;
  }
  if (Number.isInteger(reading.value)) return `${reading.value}${units}`;
  return `${Math.round(reading.value * 100) / 100}${units}`;
}

/** Prefer Homey icon id from the capability, then the device. */
export function preferHomeyIconId(device, capability) {
  return cleanHomeyIconId(capability?.iconId) || cleanHomeyIconId(device?.iconId) || '';
}

/**
 * Room temperature beside a thermostat control (setpoint / onoff / heater).
 * Skipped when the pin already is that measure capability.
 */
export function companionTemperature(device, pin) {
  if (!device || pin?.kind !== 'capability') return null;
  const caps = Array.isArray(device.capabilities) ? device.capabilities : [];
  const measure = caps.find((cap) => {
    const id = String(cap?.id || '');
    return id === 'measure_temperature' || id.startsWith('measure_temperature.');
  });
  if (!measure || typeof measure.value !== 'number' || !Number.isFinite(measure.value)) return null;
  if (String(pin.capabilityId) === String(measure.id)) return null;
  const capId = String(pin.capabilityId || '');
  const isTempControl = capId === 'target_temperature' || capId.startsWith('target_temperature');
  const isClimate = device.deviceClass === 'thermostat' || device.deviceClass === 'heater';
  if (!isTempControl && !isClimate) return null;
  return {
    value: measure.value,
    units: measure.units || '°C',
    capabilityId: measure.id,
  };
}
