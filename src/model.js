// -----------------------------------------------------------------------------
// myStrom devices -> Gladys devices (pure).
//
// A known device (a record of `devices` in /data, see src/store.js and the
// "Known devices" part of src/app.js) becomes one Gladys device whose
// external ids are built from its MAC: `gladys.externalIds('mystrom', MAC)`,
// whatever its model, so they never change. Feature keys are frozen too.
//
// `readValues(record, reading)` turns what the device answered into
// `featureKey -> value`, the values Gladys expects (binary 0/1, %, W, kWh, °C,
// lux, mireds, RGB integer).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { BUTTON_STATUS } from './constants.js';
import { bootIdOf } from './energy.js';
import { MONO } from './mystrom/light.js';

export const EXTERNAL_ID_TYPE = 'mystrom';

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** The feature specs of each kind; `measure` ones are spaced by the publisher. */
const SPECS = {
  switch: {
    name: 'Switch',
    category: C.SWITCH,
    type: T.SWITCH.BINARY,
    write: true,
  },
  power: {
    name: 'Power',
    category: C.SWITCH,
    type: T.SWITCH.POWER,
    unit: U.WATT,
    min: 0,
    max: 4000,
    measure: true,
  },
  energy: {
    name: 'Energy',
    category: C.SWITCH,
    type: T.SWITCH.ENERGY,
    unit: U.KILOWATT_HOUR,
    min: 0,
    max: 1_000_000,
    measure: true,
  },
  // The room temperature measured by the motion sensor.
  temperature: {
    name: 'Temperature',
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 85,
    measure: true,
  },
  // The temperature of a switch is read inside the plug, warmed by its load:
  // a device temperature, kept out of the room average.
  'switch:temperature': {
    name: 'Device temperature',
    category: C.DEVICE_TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 125,
    measure: true,
  },
  light: { name: 'Light', category: C.LIGHT, type: T.LIGHT.BINARY, write: true },
  brightness: {
    name: 'Brightness',
    category: C.LIGHT,
    type: T.LIGHT.BRIGHTNESS,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    write: true,
  },
  color: {
    name: 'Color',
    category: C.LIGHT,
    type: T.LIGHT.COLOR,
    min: 0,
    max: 0xffffff,
    write: true,
  },
  white: {
    name: 'White temperature',
    category: C.LIGHT,
    type: T.LIGHT.TEMPERATURE,
    min: MONO.coldMireds,
    max: MONO.warmMireds,
    write: true,
  },
  'light-power': {
    name: 'Power',
    category: C.LIGHT,
    type: T.LIGHT.POWER,
    unit: U.WATT,
    min: 0,
    max: 100,
    measure: true,
  },
  motion: {
    name: 'Motion',
    category: C.MOTION_SENSOR,
    type: T.SENSOR.BINARY,
  },
  'light-level': {
    name: 'Light level',
    category: C.LIGHT_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.LUX,
    min: 0,
    max: 100_000,
    measure: true,
  },
  button: {
    name: 'Button',
    category: C.BUTTON,
    type: T.BUTTON.CLICK,
    min: BUTTON_STATUS.CLICK,
    max: BUTTON_STATUS.PRESSED,
    event: true,
  },
};

/** The feature keys a known device has. */
export function featureKeys(record) {
  switch (record.kind) {
    case 'switch':
      return [
        'switch',
        ...(record.caps?.power ? ['power'] : []),
        ...(record.caps?.energy ? ['energy'] : []),
        ...(record.caps?.temperature ? ['temperature'] : []),
      ];
    case 'bulb':
      return ['light', 'brightness', 'color', 'white', 'light-power'];
    case 'strip':
      return ['light', 'brightness', 'color', 'light-power'];
    case 'pir':
      return ['motion', 'light-level', 'temperature'];
    case 'button':
      return ['button'];
    default:
      return [];
  }
}

/** The spec of a feature key, on a kind of device (the same key may differ by kind). */
export const specOf = (key, kind) => SPECS[`${kind}:${key}`] ?? SPECS[key];

export function deviceName(record) {
  return (record.name || `myStrom ${record.model} ${record.mac.slice(-4)}`).slice(0, 100);
}

/** The Gladys device of a known device. */
export function buildDevice(gladys, record) {
  const ids = gladys.externalIds(EXTERNAL_ID_TYPE, record.mac);
  const features = featureKeys(record).map((key) => {
    const spec = specOf(key, record.kind);
    const feature = {
      name: spec.name,
      external_id: ids.feature(key),
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !spec.write,
      // The button is an event: no state to read back.
      has_feedback: !spec.event,
      keep_history: true,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    return feature;
  });
  const params = [
    { name: 'IP_ADDRESS', value: record.address ?? '' },
    { name: 'MAC', value: record.mac },
    { name: 'MODEL', value: record.model },
    { name: 'FIRMWARE', value: record.firmware ?? '' },
  ].filter((param) => param.value !== '');
  return {
    name: deviceName(record),
    external_id: ids.device,
    features,
    params,
    should_poll: false,
  };
}

/** What a switch's /report says it measures. */
export function switchCaps(report) {
  return {
    power: finite(report?.power) !== undefined,
    temperature: finite(report?.temperature) !== undefined,
    energy: finite(report?.energy_since_boot) !== undefined && bootIdOf(report) !== undefined,
  };
}

/**
 * The capabilities only grow: a report missing a field once (a firmware
 * hiccup) never removes a feature, and a firmware update can add one.
 */
export function mergeCaps(previous, next) {
  return {
    power: Boolean(previous?.power || next?.power),
    temperature: Boolean(previous?.temperature || next?.temperature),
    energy: Boolean(previous?.energy || next?.energy),
  };
}

/**
 * featureKey -> value from a reading:
 * - switch: `{ report, energyKwh }`;
 * - bulb / strip: `{ light }` (parseLightState);
 * - pir: `{ sensors }`.
 */
export function readValues(record, reading) {
  const values = new Map();
  const set = (key, value) => {
    if (value !== undefined && featureKeys(record).includes(key)) {
      values.set(key, value);
    }
  };
  if (record.kind === 'switch' && reading.report) {
    const { report } = reading;
    if (typeof report.relay === 'boolean' || typeof report.relay === 'number') {
      set('switch', report.relay ? 1 : 0);
    }
    const power = finite(report.power);
    set('power', power === undefined ? undefined : round(Math.max(0, power), 1));
    const temperature = finite(report.temperature);
    set('temperature', temperature === undefined ? undefined : round(temperature, 1));
    set(
      'energy',
      finite(reading.energyKwh) === undefined ? undefined : round(reading.energyKwh, 3),
    );
  }
  if ((record.kind === 'bulb' || record.kind === 'strip') && reading.light) {
    const { light } = reading;
    set('light', light.on ? 1 : 0);
    set('brightness', light.brightness);
    set('color', light.color);
    set('white', light.mireds);
    set('light-power', light.power);
  }
  if (record.kind === 'pir' && reading.sensors) {
    const { sensors } = reading;
    if (typeof sensors.motion === 'boolean' || typeof sensors.motion === 'number') {
      set('motion', sensors.motion ? 1 : 0);
    }
    const light = finite(sensors.light);
    set('light-level', light === undefined ? undefined : Math.max(0, round(light, 1)));
    const temperature = finite(sensors.temperature);
    set('temperature', temperature === undefined ? undefined : round(temperature, 1));
  }
  return values;
}
