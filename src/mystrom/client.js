// -----------------------------------------------------------------------------
// The local REST API of the myStrom devices (plain HTTP on port 80, no cloud),
// after the official API documentation (api.mystrom.ch) and python-mystrom
// (MIT, home-assistant-ecosystem). Ported, not copied: the endpoints are
//
//   GET  /api/v1/info (recent firmware) or /info.json     every device
//   GET  /report, GET /relay?state=0|1                    Switch
//   GET  /api/v1/device/<MAC>, POST the same (form)       Bulb, LED Strip, Buttons
//   GET  /api/v1/sensors                                  Motion Sensor
//
// The bulbs refuse JSON bodies: commands are application/x-www-form-urlencoded.
// A device secured in the myStrom app wants its token in the `Token` header.
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from '../constants.js';

export class MyStromError extends Error {
  /**
   * @param {string} message
   * @param {'timeout'|'unreachable'|'auth'|'http'|'invalid'} kind
   * @param {number} [status]
   */
  constructor(message, kind, status) {
    super(message);
    this.name = 'MyStromError';
    this.kind = kind;
    this.status = status;
  }
}

/** MAC as the API wants it in its paths: 12 upper-case hex digits. */
export function normalizeMac(raw) {
  const mac = String(raw ?? '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
  return /^[0-9A-F]{12}$/.test(mac) ? mac : undefined;
}

export class MyStromClient {
  constructor({ fetchImpl = globalThis.fetch, timeout = TIMINGS.requestTimeout } = {}) {
    this.fetch = fetchImpl;
    this.timeout = timeout;
  }

  /**
   * One request. `address` is host[:port] as built by config.urlHost.
   * @returns {Promise<any>} the JSON answer, or the text when it is not JSON
   */
  async request(address, path, { method = 'GET', form, token } = {}) {
    const headers = { Accept: 'application/json, text/plain, */*' };
    if (token) {
      headers.Token = token;
    }
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = encodeForm(form);
    }
    let response;
    try {
      response = await this.fetch(`http://${address}${path}`, {
        method,
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new MyStromError(
        timeout ? 'no answer' : `unreachable (${err?.cause?.code ?? err?.message ?? err})`,
        timeout ? 'timeout' : 'unreachable',
      );
    }
    const text = await response.text();
    if (text.length > LIMITS.responseBytes) {
      throw new MyStromError('answer too large', 'invalid', response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw new MyStromError('token refused', 'auth', response.status);
    }
    if (!response.ok) {
      throw new MyStromError(`HTTP ${response.status}`, 'http', response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async json(address, path, options) {
    const answer = await this.request(address, path, options);
    if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new MyStromError('unexpected answer', 'invalid');
    }
    return answer;
  }

  /**
   * A read whose path every firmware serves: a secured device answers 404
   * (not 401) when the token is missing or wrong, as python-mystrom reads it.
   */
  async read(address, path, options) {
    try {
      return await this.json(address, path, options);
    } catch (err) {
      throw err.status === 404 ? tokenError() : err;
    }
  }

  /** Model, MAC and firmware; /info.json on the firmware without /api/v1/info. */
  async info(address, token) {
    try {
      return await this.json(address, '/api/v1/info', { token });
    } catch (err) {
      if (err.kind !== 'http' && err.kind !== 'invalid') {
        throw err;
      }
      const first = err.status;
      try {
        return await this.json(address, '/info.json', { token });
      } catch (fallback) {
        // Both paths missing: the firmware hides them behind its token.
        throw first === 404 && fallback.status === 404 ? tokenError() : fallback;
      }
    }
  }

  /** Switch: `{ power, Ws, relay, temperature, boot_id, energy_since_boot, time_since_boot }`. */
  report(address, token) {
    return this.read(address, '/report', { token });
  }

  async setRelay(address, on, token) {
    try {
      return await this.request(address, `/relay?state=${on ? 1 : 0}`, { token });
    } catch (err) {
      throw err.status === 404 ? tokenError() : err;
    }
  }

  /** Bulb, LED strip and buttons: the entry of their MAC in `{ "<MAC>": { ... } }`. */
  async deviceState(address, mac, token) {
    const answer = await this.read(address, `/api/v1/device/${mac}`, { token });
    // Only the entry of this MAC: another device answering at this address is not this one.
    const entry = Object.hasOwn(answer, mac) ? answer[mac] : undefined;
    if (entry === null || typeof entry !== 'object') {
      throw new MyStromError(`no state for ${mac} at this address`, 'invalid');
    }
    return entry;
  }

  /** Bulb and LED strip commands (`action`, `color`, `ramp`), answered with the new state. */
  async setDevice(address, mac, form, token) {
    let answer;
    try {
      answer = await this.request(address, `/api/v1/device/${mac}`, {
        method: 'POST',
        form,
        token,
      });
    } catch (err) {
      throw err.status === 404 ? tokenError() : err;
    }
    const entry =
      answer && typeof answer === 'object' && Object.hasOwn(answer, mac) ? answer[mac] : undefined;
    return entry && typeof entry === 'object' ? entry : undefined;
  }

  /** Motion Sensor: `{ motion, light, temperature }`. */
  pirSensors(address, token) {
    return this.read(address, '/api/v1/sensors', { token });
  }
}

const tokenError = () => new MyStromError('token missing or refused (HTTP 404)', 'auth', 404);

/**
 * A form body as the myStrom firmware reads it: `k=v&…`, each part
 * percent-encoded, then `;`, `:` and `/` put back in clear — the bulbs parse
 * `color=120;100;50` and the buttons `single=get://host/path` literally (as
 * python-mystrom and openHAB send them).
 */
export function encodeForm(form) {
  const encode = (text) =>
    encodeURIComponent(String(text))
      .replace(/%3B/gi, ';')
      .replace(/%3A/gi, ':')
      .replace(/%2F/gi, '/');
  return Object.entries(form)
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}
