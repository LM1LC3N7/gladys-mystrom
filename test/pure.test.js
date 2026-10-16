// -----------------------------------------------------------------------------
// The pure parts: configuration, device identity, UDP announcements, light
// colours, energy index, Gladys devices and values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig, parseAddresses, parseHost } from '../src/config.js';
import { nextEnergy } from '../src/energy.js';
import { buildDevice, featureKeys, mergeCaps, readValues, switchCaps } from '../src/model.js';
import { StatePublisher } from '../src/publisher.js';
import { deviceType, parseAnnouncements, parseInfo } from '../src/mystrom/info.js';
import {
  hsvToRgb,
  miredsToMono,
  monoToMireds,
  parseLightState,
  rgbToHsv,
} from '../src/mystrom/light.js';
import {
  BULB_MAC,
  BULB_MONO_STATE,
  BULB_STATE,
  PIR_SENSORS,
  STRIP_MAC,
  STRIP_STATE,
  SWITCH_INFO,
  SWITCH_REPORT,
  SWITCH_V1_INFO,
  SWITCH_V1_REPORT,
  announcement,
} from './fixtures/mystrom.js';

test('addresses: separators, URLs pasted, ports kept, junk reported', () => {
  assert.deepEqual(
    parseAddresses('192.168.1.30, 192.168.1.31;switch-1.lan\nhttp://10.0.0.5/report'),
    {
      valid: ['192.168.1.30', '192.168.1.31', 'switch-1.lan', '10.0.0.5'],
      invalid: [],
    },
  );
  assert.deepEqual(parseAddresses('192.168.1.30 192.168.1.30 bad_host 10.0.0.9:8080'), {
    valid: ['192.168.1.30', '10.0.0.9:8080'],
    invalid: ['bad_host'],
  });
  assert.deepEqual(parseHost('[fe80::1]:80'), { host: 'fe80::1', port: 80 });
  assert.deepEqual(parseHost('1.2.3.4:99999'), { error: 'invalid' });
});

test('configuration: defaults and bounds', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.addresses, []);
  assert.equal(config.pollInterval, 10);
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 5);
  assert.equal(normalizeConfig({ poll_interval: '9000' }).pollInterval, 300);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 10);
  assert.equal(normalizeConfig({ api_token: '  abc ' }).token, 'abc');
  assert.equal(normalizeConfig({ gladys_address: '192.168.1.10' }).gladysHost, '192.168.1.10');
  assert.equal(normalizeConfig({ gladys_address: '192.168.1.10:80' }).gladysHostError, true);
});

test('device types: numbers, codes, unknown ones', () => {
  assert.equal(deviceType(107).kind, 'switch');
  assert.equal(deviceType('WSE').id, 107);
  assert.equal(deviceType('105').kind, 'strip');
  assert.equal(deviceType('BP2').touch, true);
  assert.equal(deviceType(113), undefined, 'modulo STECCO is not supported');
  assert.deepEqual(parseInfo(SWITCH_INFO), {
    mac: '64002D010203',
    typeId: 107,
    kind: 'switch',
    model: 'Switch EU',
    touch: false,
    firmware: '3.82.60',
    name: 'Coffee machine',
  });
  assert.equal(parseInfo(SWITCH_V1_INFO).mac, '5CCF7F112233', 'colons dropped');
  assert.equal(parseInfo({ mac: '64002D010203', type: 999 }), undefined);
  assert.equal(parseInfo({ type: 107 }), undefined);
});

test('UDP announcements: 8 bytes, one per MAC, junk skipped', () => {
  const found = parseAnnouncements([
    announcement('64002d010203', 107, '192.168.1.30'),
    announcement('64002d010203', 107, '192.168.1.32'),
    announcement('5ccf7f02d676', 104, '192.168.1.40'),
    { source_ip: '192.168.1.50', payload_base64: Buffer.from('hello').toString('base64') },
    announcement('aabbccddeeff', 200, '192.168.1.60'),
  ]);
  assert.deepEqual(
    found.map((d) => [d.mac, d.ip, d.kind]),
    [
      ['64002D010203', '192.168.1.32', 'switch'],
      ['5CCF7F02D676', '192.168.1.40', 'button'],
    ],
  );
  assert.deepEqual(parseAnnouncements(undefined), []);
});

test('colours: HSV and RGB both ways, the mono white scale', () => {
  assert.equal(hsvToRgb(0, 100, 100), 0xff0000);
  assert.equal(hsvToRgb(120, 100, 100), 0x00ff00);
  assert.equal(hsvToRgb(240, 100, 100), 0x0000ff);
  assert.equal(hsvToRgb(0, 0, 100), 0xffffff);
  assert.deepEqual(rgbToHsv(0xff0000), { h: 0, s: 100, v: 100 });
  assert.deepEqual(rgbToHsv(0x00ffff), { h: 180, s: 100, v: 100 });
  assert.equal(monoToMireds(1), 370);
  assert.equal(monoToMireds(18), 154);
  assert.equal(miredsToMono(370), 1);
  assert.equal(miredsToMono(154), 18);
  assert.equal(miredsToMono(1000), 1, 'clamped');
});

test('light states: hsv, mono, rgb', () => {
  const hsv = parseLightState(BULB_STATE[BULB_MAC]);
  assert.equal(hsv.mode, 'hsv');
  assert.equal(hsv.on, true);
  assert.equal(hsv.brightness, 14);
  assert.equal(hsv.color, hsvToRgb(191, 90, 100));
  assert.equal(hsv.power, 1);
  const mono = parseLightState(BULB_MONO_STATE[BULB_MAC]);
  assert.equal(mono.mode, 'mono');
  assert.equal(mono.brightness, 80);
  assert.equal(mono.mireds, monoToMireds(10));
  assert.equal(mono.color, undefined);
  const rgb = parseLightState(STRIP_STATE[STRIP_MAC]);
  assert.equal(rgb.mode, 'rgb');
  assert.equal(rgb.on, false);
  assert.equal(rgb.color, 0xff0000);
  assert.equal(rgb.brightness, 100);
  assert.equal(parseLightState({ on: true, color: 'FF000000' }).color, 0xffffff, 'white channel');
  assert.deepEqual(parseLightState({}), { on: false, mode: '' });
});

test('energy index: grows across restarts of the switch', () => {
  const first = nextEnergy(undefined, { boot_id: 'A', energy_since_boot: 3_600_000 });
  assert.equal(first.kwh, 1);
  const second = nextEnergy(first.counter, { boot_id: 'A', energy_since_boot: 7_200_000 });
  assert.equal(second.kwh, 2);
  const restarted = nextEnergy(second.counter, { boot_id: 'B', energy_since_boot: 360_000 });
  assert.equal(restarted.kwh, 2.1);
  const reset = nextEnergy(restarted.counter, { boot_id: 'B', energy_since_boot: 0 });
  assert.equal(reset.kwh, 2.1, 'a counter going back is a reset');
  assert.equal(nextEnergy(undefined, { power: 3 }), undefined, 'old firmware: no index');
});

test('Gladys devices: ids from the MAC, features from what the device measures', () => {
  const gladys = createFakeGladys({ selector: 'mystrom' });
  const record = {
    mac: '64002D010203',
    kind: 'switch',
    model: 'Switch EU',
    firmware: '3.82.60',
    name: 'Coffee machine',
    address: '192.168.1.30',
    caps: switchCaps(SWITCH_REPORT),
  };
  const device = buildDevice(gladys, record);
  assert.equal(device.external_id, 'ext:mystrom:mystrom:64002D010203');
  assert.equal(device.name, 'Coffee machine');
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    ['switch', 'power', 'energy', 'temperature'],
  );
  assert.deepEqual(
    device.params.find((p) => p.name === 'IP_ADDRESS'),
    {
      name: 'IP_ADDRESS',
      value: '192.168.1.30',
    },
  );
  const v1 = { ...record, caps: switchCaps(SWITCH_V1_REPORT), name: '' };
  assert.deepEqual(featureKeys(v1), ['switch', 'power']);
  assert.equal(buildDevice(gladys, v1).name, 'myStrom Switch EU 0203');
  const values = readValues(record, { report: SWITCH_REPORT, energyKwh: 2.0000001 });
  assert.deepEqual(Object.fromEntries(values), {
    switch: 1,
    power: 1532.5,
    temperature: 23.5,
    energy: 2,
  });
  assert.deepEqual(Object.fromEntries(readValues(v1, { report: SWITCH_V1_REPORT })), {
    switch: 0,
    power: 0,
  });
});

test('Gladys values of lights, motion sensors and buttons', () => {
  const bulb = { mac: BULB_MAC, kind: 'bulb', model: 'Bulb' };
  const values = readValues(bulb, { light: parseLightState(BULB_MONO_STATE[BULB_MAC]) });
  assert.deepEqual(Object.fromEntries(values), {
    light: 1,
    brightness: 80,
    white: monoToMireds(10),
    'light-power': 4.1,
  });
  const strip = { mac: STRIP_MAC, kind: 'strip', model: 'LED Strip' };
  assert.ok(!featureKeys(strip).includes('white'), 'the strip has no white channel');
  const pir = { mac: '083A8D0A0B0C', kind: 'pir', model: 'Motion Sensor' };
  assert.deepEqual(Object.fromEntries(readValues(pir, { sensors: PIR_SENSORS })), {
    motion: 1,
    'light-level': 42,
    temperature: 21.2,
  });
  const button = { mac: '5CCF7F02D676', kind: 'button', model: 'Button' };
  const gladys = createFakeGladys();
  const [feature] = buildDevice(gladys, button).features;
  assert.equal(feature.category, 'button');
  assert.equal(feature.read_only, true);
  assert.equal(feature.has_feedback, false);
});

test('energy: a restart is a new boot_id or an uptime going back, numeric ids too', () => {
  const first = nextEnergy(undefined, {
    boot_id: 7,
    energy_since_boot: 3_600_000,
    time_since_boot: 100,
  });
  assert.equal(first.counter.bootId, '7');
  const same = nextEnergy(first.counter, {
    boot_id: 7,
    energy_since_boot: 7_200_000,
    time_since_boot: 200,
  });
  assert.equal(same.kwh, 2);
  const rebooted = nextEnergy(same.counter, {
    boot_id: 7,
    energy_since_boot: 360_000,
    time_since_boot: 5,
  });
  assert.equal(rebooted.kwh, 2.1, 'same id, uptime back: a restart');
  const glitch = nextEnergy(rebooted.counter, {
    boot_id: 7,
    energy_since_boot: 0,
    time_since_boot: 6,
  });
  assert.equal(glitch.kwh, 2.1, 'same start, counter lower: never goes back');
  assert.equal(nextEnergy(undefined, { boot_id: '', energy_since_boot: 1 }), undefined);
  assert.equal(switchCaps({ energy_since_boot: 1, boot_id: 0 }).energy, true, 'numeric boot_id');
});

test('switch capabilities only grow', () => {
  const full = switchCaps(SWITCH_REPORT);
  assert.deepEqual(mergeCaps(full, switchCaps({ relay: true })), full);
  assert.deepEqual(mergeCaps(undefined, switchCaps(SWITCH_V1_REPORT)), {
    power: true,
    temperature: false,
    energy: false,
  });
});

test('the temperature of a switch is a device temperature, the motion sensor one a room one', () => {
  const gladys = createFakeGladys();
  const sw = buildDevice(gladys, {
    mac: '64002D010203',
    kind: 'switch',
    model: 'Switch EU',
    caps: switchCaps(SWITCH_REPORT),
  });
  const pir = buildDevice(gladys, { mac: '083A8D0A0B0C', kind: 'pir', model: 'Motion Sensor' });
  const temperature = (device) =>
    device.features.find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(temperature(sw).category, 'device-temperature-sensor');
  assert.equal(temperature(pir).category, 'temperature-sensor');
});

test('publisher: relays, motion and presses go first when the budget is short', async () => {
  const sent = [];
  const gladys = {
    publishChangedStates: async (batch) => {
      sent.push(...batch.map((s) => s.device_feature_external_id));
      return { count: batch.length };
    },
    forgetPublishedStates: () => {},
  };
  const publisher = new StatePublisher({ gladys, budget: 2, timers: globalThis });
  publisher.configure({ throttled: new Set(['a:power', 'b:power']), events: new Set() });
  publisher.push('a:power', { state: 1 });
  publisher.push('b:power', { state: 2 });
  publisher.push('a:switch', { state: 1 });
  await publisher.flush();
  assert.deepEqual(sent, ['a:switch', 'a:power']);
});
