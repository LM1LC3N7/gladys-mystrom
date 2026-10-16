// -----------------------------------------------------------------------------
// Fixed values: manifest keys (frozen: users store them in their scenes and
// configuration), the button receiver sub-container, the Gladys core value
// enums the SDK does not export, the myStrom device types, limits and timings.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  FIND: 'find_devices',
  SETUP_BUTTONS: 'setup_buttons',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  BUTTON: 'button_pressed',
};

/** The presses a myStrom button reports (its action URL names), frozen. */
export const PRESSES = ['single', 'double', 'long', 'touch'];

/** The button receiver of the manifest `containers` (same image, `node src/receiver.js`). */
export const RECEIVER = {
  name: 'mystrom-buttons',
  /** HTTP port the buttons call, published by Gladys on a host port it chooses. */
  httpPort: 8080,
  httpPortName: 'buttons',
  /** Channel to the main container, on the private network of the integration only. */
  channelPort: 7778,
};

/** UDP port the myStrom devices announce themselves on (broadcast, every ~5 s). */
export const ANNOUNCE_PORT = 7979;

// Gladys core enums (server/utils/constants.js), not exported by the SDK.
export const BUTTON_STATUS = { CLICK: 1, DOUBLE_CLICK: 2, LONG_CLICK: 6, PRESSED: 60 };

/** The button feature value of each press. */
export const PRESS_VALUES = {
  single: BUTTON_STATUS.CLICK,
  double: BUTTON_STATUS.DOUBLE_CLICK,
  long: BUTTON_STATUS.LONG_CLICK,
  touch: BUTTON_STATUS.PRESSED,
};

/**
 * myStrom device types (`type` of /api/v1/info: a number on recent firmware, a
 * code on older ones, the 7th byte of the UDP announcement), after the
 * official API documentation and python-mystrom's device_types.py.
 */
export const DEVICE_TYPES = {
  101: { code: 'WSW', kind: 'switch', model: 'Switch CH v1' },
  102: { code: 'WRB', kind: 'bulb', model: 'Bulb' },
  103: { code: 'WBP', kind: 'button', model: 'Button Plus', touch: true },
  104: { code: 'WBS', kind: 'button', model: 'Button' },
  105: { code: 'WRS', kind: 'strip', model: 'LED Strip' },
  106: { code: 'WS2', kind: 'switch', model: 'Switch CH v2' },
  107: { code: 'WSE', kind: 'switch', model: 'Switch EU' },
  110: { code: 'WMS', kind: 'pir', model: 'Motion Sensor' },
  118: { code: 'BP2', kind: 'button', model: 'Button Plus (2nd gen)', touch: true },
  120: { code: 'LCS', kind: 'switch', model: 'Switch Zero' },
};

export const KINDS = ['switch', 'bulb', 'strip', 'button', 'pir'];

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin. */
  statesPerMinute: 250,
  /** Gladys accepts 300 scene events per minute per integration. */
  eventsPerMinute: 240,
  /** Devices handled (each one is polled over HTTP). */
  devices: 200,
  /** Body of a device answer. */
  responseBytes: 64 * 1024,
  /** Addresses typed in the configuration. */
  addresses: 200,
};

export const TIMINGS = {
  /** One HTTP request to a device. */
  requestTimeout: 5000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** Measurements (power, temperature, light) of a feature are spaced by this much. */
  measureInterval: 60_000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** An address that never answered is tried again this often (and a lost device searched). */
  probeRetry: 60_000,
  /** The MAC answering at a known address is checked again this often (DHCP may reassign it). */
  verifyInterval: 10 * 60_000,
  /** A device that lost its address is searched again this often until found. */
  lostSearch: 5 * 60_000,
  /** Devices asked at once after a search. */
  probeConcurrency: 8,
  /** UDP announcement capture (seconds, 1-30): devices announce every ~5 s. */
  scanSeconds: 7,
  /** Saving /data waits this long for more changes. */
  persistDelay: 1000,
};

/** Configuration bounds (mirrored by the manifest). */
export const POLL_INTERVAL = { default: 10, min: 5, max: 300 };
