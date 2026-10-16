// -----------------------------------------------------------------------------
// Device answers shaped like the ones of the myStrom documentation
// (api.mystrom.ch) and python-mystrom's tests. Not recorded from real devices.
// -----------------------------------------------------------------------------

export const SWITCH_MAC = '64002D010203';
export const BULB_MAC = '5CCF7FA0C27C';
export const STRIP_MAC = '5CCF7FA0C2AA';
export const BUTTON_MAC = '5CCF7F02D676';
export const BUTTON_PLUS_MAC = '5CCF7F02D677';
export const PIR_MAC = '083A8D0A0B0C';

export const SWITCH_INFO = {
  version: '3.82.60',
  mac: '64002D010203',
  type: 107,
  name: 'Coffee machine',
  ssid: 'home',
  ip: '192.168.1.30',
  mask: '255.255.255.0',
  gw: '192.168.1.1',
  dns: '192.168.1.1',
  static: false,
  connected: true,
  signal: -61,
};

export const SWITCH_REPORT = {
  power: 1532.456,
  Ws: 1530.12,
  relay: true,
  temperature: 23.47,
  boot_id: 'A1B2C3D4',
  energy_since_boot: 7_200_000,
  time_since_boot: 3600,
};

/** Switch CH v1, old firmware: no /api/v1/info, no temperature, no energy counter. */
export const SWITCH_V1_INFO = { version: '2.68.10', mac: '5C:CF:7F:11:22:33', type: 'WSW' };
export const SWITCH_V1_REPORT = { power: 0, relay: false };

export const BULB_INFO = { version: '2.59.32', mac: BULB_MAC, type: 102 };
export const BULB_STATE = {
  [BULB_MAC]: {
    type: 'rgblamp',
    battery: false,
    reachable: true,
    meshroot: false,
    on: true,
    color: '191;90;14',
    mode: 'hsv',
    ramp: 100,
    power: 0.953,
    fw_version: '2.59.32',
  },
};
export const BULB_MONO_STATE = {
  [BULB_MAC]: { on: true, color: '10;80', mode: 'mono', ramp: 100, power: 4.1 },
};

export const STRIP_INFO = { version: '2.59.32', mac: STRIP_MAC, type: 'WRS' };
export const STRIP_STATE = {
  [STRIP_MAC]: { type: 'strip', on: false, color: '00FF0000', mode: 'rgb', ramp: 0, power: 0.4 },
};

export const BUTTON_INFO = { version: '2.74.31', mac: BUTTON_MAC, type: 104 };
export const BUTTON_PLUS_INFO = { version: '2.74.31', mac: BUTTON_PLUS_MAC, type: 'WBP' };

export const PIR_INFO = { version: '3.82.60', mac: PIR_MAC, type: 110 };
export const PIR_SENSORS = { motion: true, light: 42, temperature: 21.2345 };

/** The 8 bytes a device broadcasts on UDP 7979: MAC, type, status flags. */
export const announcement = (mac, type, ip, flags = 0x06) => ({
  source_ip: ip,
  source_port: 7979,
  payload_base64: Buffer.concat([Buffer.from(mac, 'hex'), Buffer.from([type, flags])]).toString(
    'base64',
  ),
});

/**
 * A fake network of myStrom devices behind `fetch`: address -> route table.
 * Every request is recorded; an address absent from the table does not answer.
 */
export function fakeFetch(devices) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const { host, pathname, search } = new URL(url);
    calls.push({ host, path: pathname + search, method: options.method ?? 'GET', ...options });
    const device = devices[host];
    if (!device) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EHOSTUNREACH' } });
    }
    if (device.token && options.headers?.Token !== device.token) {
      return new Response('Unauthorized', { status: 401 });
    }
    const handler = device.routes[`${options.method ?? 'GET'} ${pathname}`];
    if (!handler) {
      return new Response('Not found', { status: 404 });
    }
    const body = typeof handler === 'function' ? handler({ search, body: options.body }) : handler;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' },
    });
  };
  return { fetchImpl, calls };
}
