// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form.
// -----------------------------------------------------------------------------

import { LIMITS, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  addresses: '',
  poll_interval: POLL_INTERVAL.default,
  callback_address: '',
};

/**
 * The key this field had up to 0.1.3. Gladys stores the config keys
 * upper-cased and hands the GLADYS_* ones back as is (its reserved namespace),
 * so `gladys_address` came back as `GLADYS_ADDRESS` and the field never
 * reached the code. Installations of 0.1.3 still hold the value under that
 * name: it is read as a fallback until the user saves the new field.
 */
export const LEGACY_CALLBACK_KEY = 'GLADYS_ADDRESS';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An address typed by the user: an IP address or a host name. A pasted URL
 * ("http://192.168.1.30/report") is reduced to its host; a port is kept.
 * @returns {{ host: string, port?: number } | { error: 'invalid' }} `host` is '' when empty.
 */
export function parseHost(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { host: '' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return withPort(bracketed[1].toLowerCase(), bracketed[2]);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return { host: text.toLowerCase() };
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2]);
}

function withPort(host, port) {
  if (port === undefined) {
    return { host };
  }
  const number = Number(port);
  return number >= 1 && number <= 65535 ? { host, port: number } : { error: 'invalid' };
}

/** host[:port] as it goes in a URL: an IPv6 address between brackets. */
export const urlHost = (host, port) =>
  `${host.includes(':') ? `[${host}]` : host}${port ? `:${port}` : ''}`;

/** The addresses list: separated by commas, semicolons, spaces or new lines. */
export function parseAddresses(raw) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of String(raw ?? '').split(/[\s,;]+/)) {
    if (entry === '') {
      continue;
    }
    const parsed = parseHost(entry);
    if (parsed.error || parsed.host === '') {
      invalid.push(entry.slice(0, 100));
      continue;
    }
    const address = urlHost(parsed.host, parsed.port);
    if (!seen.has(address) && valid.length < LIMITS.addresses) {
      seen.add(address);
      valid.push(address);
    }
  }
  return { valid, invalid };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function normalizeConfig(raw = {}) {
  const c = {
    ...DEFAULT_CONFIG,
    ...Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v != null)),
  };
  const { valid, invalid } = parseAddresses(c.addresses);
  const interval = Number(c.poll_interval);
  // An empty new field falls back to the value saved under the old key.
  const gladys = parseHost(text(c.callback_address) || c[LEGACY_CALLBACK_KEY]);
  return {
    addresses: valid,
    invalidAddresses: invalid,
    token: text(c.api_token),
    pollInterval: Number.isFinite(interval)
      ? Math.min(POLL_INTERVAL.max, Math.max(POLL_INTERVAL.min, Math.round(interval)))
      : POLL_INTERVAL.default,
    gladysHost: gladys.error ? '' : gladys.port ? '' : gladys.host,
    gladysHostError: Boolean(gladys.error || gladys.port),
  };
}
