/**
 * Homey Pro local Web API.
 *
 * Documented calls used here:
 *   GET  /api/manager/devices/device/
 *   PUT  /api/manager/devices/device/:deviceId/capability/:capabilityId   { value }
 *   GET  /api/manager/flow/flow/
 *   POST /api/manager/flow/flow/:id/trigger
 *   GET  /api/manager/flow/advancedflow/
 *   POST /api/manager/flow/advancedflow/:id/trigger
 *   GET  /webhook?event=&tag=
 *
 * The bearer token is sent only to the saved Homey origin. Webhooks are the
 * unauthenticated trigger Homey documents for flow cards, still on that origin.
 * HTTP calls connect to the address that passed the guard, so a later DNS
 * answer cannot move the request onto a metadata address.
 */

import http from 'node:http';
import https from 'node:https';
import { inspectAddress } from './guard.js';

const NETWORK_DETAILS = new Set(['timeout', 'noroute', 'refused']);

export function classifyNetworkError(err) {
  const code = err?.code;
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENETDOWN') return 'noroute';
  return 'timeout';
}

export class HomeyRequestError extends Error {
  constructor(homeyStatus, detail = null) {
    const unauthorized = homeyStatus === 401 || homeyStatus === 403;
    super(unauthorized ? 'Homey rejected the API key.' : 'Homey could not be reached.');
    this.status = unauthorized ? 401 : 502;
    this.reason = unauthorized ? 'homey_unauthorized' : 'homey_unreachable';
    this.homeyStatus = homeyStatus;
    this.detail = !unauthorized && NETWORK_DETAILS.has(detail) ? detail : null;
  }
}

function requestOnce({ target, token, method, path, body, auth }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = {
    Accept: 'application/json',
    Host: new URL(target.origin).host,
  };
  if (auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(payload.length);
  }
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (detail) => {
      if (settled) return;
      settled = true;
      reject(new HomeyRequestError(0, detail));
    };
    const req = lib.request({
      host: target.connectHost,
      port: target.port,
      method,
      path,
      headers,
      servername: target.hostname,
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      fail('timeout');
    });
    req.on('error', (err) => fail(classifyNetworkError(err)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function call(target, token, path, { method = 'GET', body, auth = true } = {}) {
  let res;
  try {
    res = await requestOnce({ target, token, method, path, body, auth });
  } catch (err) {
    if (err instanceof HomeyRequestError) throw err;
    throw new HomeyRequestError(0);
  }
  if (res.status >= 300 && res.status < 400) throw new HomeyRequestError(0);
  if (res.status < 200 || res.status >= 300) throw new HomeyRequestError(res.status);
  if (!res.body) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data);
  return [];
}

function capabilityList(device) {
  const obj = device.capabilitiesObj && typeof device.capabilitiesObj === 'object'
    ? device.capabilitiesObj
    : {};
  const ids = Array.isArray(device.capabilities) ? device.capabilities : Object.keys(obj);
  return ids.map((id) => {
    const cap = obj[id] && typeof obj[id] === 'object' ? obj[id] : {};
    const values = Array.isArray(cap.values)
      ? cap.values
        .map((entry) => {
          if (entry == null) return null;
          if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
            return { id: String(entry), title: String(entry) };
          }
          if (typeof entry === 'object' && entry.id != null) {
            return { id: String(entry.id), title: String(entry.title || entry.id) };
          }
          return null;
        })
        .filter(Boolean)
        .slice(0, 20)
      : [];
    return {
      id: String(id),
      title: String(cap.title || id),
      type: String(cap.type || ''),
      setable: cap.setable !== false,
      value: cap.value === undefined ? null : cap.value,
      units: cap.units ? String(cap.units) : '',
      values,
    };
  }).filter((cap) => cap.setable && cap.id && cap.id.length <= 120);
}

export function normalizeDevices(data) {
  return asList(data)
    .filter((device) => device && device.id)
    .map((device) => ({
      id: String(device.id),
      name: String(device.name || device.id),
      zone: String(device.zoneName || device.zone || ''),
      capabilities: capabilityList(device),
    }))
    .filter((device) => device.capabilities.length > 0);
}

export function normalizeFlows(data) {
  return asList(data)
    .filter((flow) => flow && flow.id && flow.enabled !== false && flow.triggerable !== false)
    .map((flow) => ({
      id: String(flow.id),
      name: String(flow.name || flow.id),
    }));
}

export function createHomeyClient({ allowLoopback = false, lookupImpl } = {}) {
  async function targetFor(address) {
    return inspectAddress(address, { allowLoopback, lookupImpl });
  }

  return {
    targetFor,
    async devices(address, token) {
      const data = await call(await targetFor(address), token, '/api/manager/devices/device/');
      return normalizeDevices(data);
    },
    async flows(address, token) {
      const data = await call(await targetFor(address), token, '/api/manager/flow/flow/');
      return normalizeFlows(data);
    },
    async advancedFlows(address, token) {
      const data = await call(await targetFor(address), token, '/api/manager/flow/advancedflow/');
      return normalizeFlows(data);
    },
    setCapability(address, token, deviceId, capabilityId, value) {
      const path = `/api/manager/devices/device/${encodeURIComponent(deviceId)}/capability/${encodeURIComponent(capabilityId)}`;
      return targetFor(address).then((target) => call(target, token, path, { method: 'PUT', body: { value } }));
    },
    triggerFlow(address, token, flowId, advanced) {
      const root = advanced ? 'advancedflow' : 'flow';
      const path = `/api/manager/flow/${root}/${encodeURIComponent(flowId)}/trigger`;
      return targetFor(address).then((target) => call(target, token, path, { method: 'POST', body: {} }));
    },
    webhook(address, event, tag) {
      const query = `event=${encodeURIComponent(event)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;
      return targetFor(address).then((target) => call(target, null, `/webhook?${query}`, { auth: false }));
    },
  };
}
