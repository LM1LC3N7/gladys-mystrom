// -----------------------------------------------------------------------------
// MyStromApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), fake devices behind `fetch`, a memory store and a fake
// channel to the button receiver. No network, no timers running.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MyStromApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { MyStromClient } from '../src/mystrom/client.js';
import { hsvToRgb, monoToMireds } from '../src/mystrom/light.js';
import { MemoryStore } from '../src/store.js';
import {
  BULB_INFO,
  BULB_MAC,
  BULB_MONO_STATE,
  BULB_STATE,
  BUTTON_INFO,
  BUTTON_MAC,
  BUTTON_PLUS_INFO,
  BUTTON_PLUS_MAC,
  PIR_INFO,
  PIR_SENSORS,
  STRIP_INFO,
  STRIP_STATE,
  SWITCH_INFO,
  SWITCH_REPORT,
  announcement,
  fakeFetch,
} from './fixtures/mystrom.js';

const SELECTOR = 'mystrom';
const id = (mac, key) => `ext:${SELECTOR}:mystrom:${mac}${key ? `:${key}` : ''}`;

/** Timers that never fire: the tests drive the polling and the flushes. */
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
};

class FakeChannel extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.started = false;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
  }
}

function network({ token } = {}) {
  let relay = true;
  let bulb = structuredClone(BULB_STATE[BULB_MAC]);
  const posts = [];
  const devices = {
    '192.168.1.30': {
      token,
      routes: {
        'GET /api/v1/info': SWITCH_INFO,
        'GET /report': () => ({ ...SWITCH_REPORT, relay }),
        'GET /relay': ({ search }) => {
          relay = search === '?state=1';
          return '';
        },
      },
    },
    '192.168.1.31': {
      token,
      routes: {
        'GET /api/v1/info': BULB_INFO,
        [`GET /api/v1/device/${BULB_MAC}`]: () => ({ [BULB_MAC]: bulb }),
        [`POST /api/v1/device/${BULB_MAC}`]: ({ body }) => {
          const form = Object.fromEntries(new URLSearchParams(body));
          posts.push(form);
          bulb = {
            ...bulb,
            ...(form.action ? { on: form.action === 'on' } : {}),
            ...(form.color ? { color: form.color } : {}),
            mode: form.color?.split(';').length === 2 ? 'mono' : 'hsv',
          };
          return { [BULB_MAC]: bulb };
        },
      },
    },
    '192.168.1.32': {
      token,
      routes: {
        'GET /api/v1/info': STRIP_INFO,
        [`GET /api/v1/device/${STRIP_INFO.mac}`]: STRIP_STATE,
      },
    },
    '192.168.1.33': {
      token,
      routes: { 'GET /api/v1/info': PIR_INFO, 'GET /api/v1/sensors': PIR_SENSORS },
    },
  };
  return { ...fakeFetch(devices), devices, posts };
}

async function setup(
  t,
  {
    config = { addresses: '192.168.1.30, 192.168.1.31, 192.168.1.32, 192.168.1.33' },
    net = network(),
    store = new MemoryStore(),
    containers = [],
    scanResults = {},
    devices = [],
  } = {},
) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, containers, scanResults, devices });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const channels = [];
  const app = new MyStromApp({
    gladys,
    logger,
    client: new MyStromClient({ fetchImpl: net.fetchImpl }),
    store,
    timers,
    createChannel: (options) => {
      const channel = new FakeChannel(options);
      channels.push(channel);
      return channel;
    },
  });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  t.after(() => app.stop());
  return { gladys, app, net, logs, channels, store };
}

/** The user creates every discovered device. */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

test('the typed addresses become the devices of the Discovery tab', async (t) => {
  const { gladys } = await setup(t);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(devices.map((d) => [d.external_id, d.name]).sort(), [
    [id('083A8D0A0B0C'), 'myStrom Motion Sensor 0B0C'],
    [id('5CCF7FA0C27C'), 'myStrom Bulb C27C'],
    [id('5CCF7FA0C2AA'), 'myStrom LED Strip C2AA'],
    [id('64002D010203'), 'Coffee machine'],
  ]);
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.en, /4 of 4 myStrom device\(s\) answer/);
  assert.match(status.message.fr, /4 appareil\(s\) myStrom sur 4/);
});

test('states: only for the created devices, a created device gets the last values', async (t) => {
  const { gladys, app } = await setup(t);
  await app.publisher.flush();
  assert.equal(gladys.fake.states.length, 0, 'nothing created yet');
  await createAll(gladys);
  await app.publisher.flush();
  assert.equal(gladys.fake.lastState(id('64002D010203', 'switch')), 1);
  assert.equal(gladys.fake.lastState(id('64002D010203', 'power')), 1532.5);
  assert.equal(gladys.fake.lastState(id('64002D010203', 'energy')), 2);
  assert.equal(gladys.fake.lastState(id('64002D010203', 'temperature')), 23.5);
  assert.equal(gladys.fake.lastState(id(BULB_MAC, 'brightness')), 14);
  assert.equal(gladys.fake.lastState(id(BULB_MAC, 'color')), hsvToRgb(191, 90, 100));
  assert.equal(gladys.fake.lastState(id('5CCF7FA0C2AA', 'light')), 0);
  assert.equal(gladys.fake.lastState(id('083A8D0A0B0C', 'motion')), 1);
  assert.equal(gladys.fake.lastState(id('083A8D0A0B0C', 'light-level')), 42);
  assert.deepEqual(
    gladys.fake.transports.map((e) => e.transport),
    ['local', 'local', 'local', 'local'],
  );
});

test('switch commands: relay, then the state read back', async (t) => {
  const { gladys, app, net } = await setup(t);
  await createAll(gladys);
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === id('64002D010203'));
  const feature = device.features.find((f) => f.external_id.endsWith(':switch'));
  const ack = await gladys.fake.setValue(device, feature, 0);
  assert.equal(ack.success, true);
  assert.ok(net.calls.some((c) => c.host === '192.168.1.30' && c.path === '/relay?state=0'));
  await app.publisher.flush();
  assert.equal(gladys.fake.lastState(feature.external_id), 0);
  const power = device.features.find((f) => f.external_id.endsWith(':power'));
  assert.equal((await gladys.fake.setValue(device, power, 3)).success, false, 'read-only');
});

test('bulb commands: on/off, brightness, colour, white, as form data', async (t) => {
  const { gladys, app, net } = await setup(t);
  await createAll(gladys);
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === id(BULB_MAC));
  const feature = (key) => device.features.find((f) => f.external_id === id(BULB_MAC, key));
  await gladys.fake.setValue(device, feature('light'), 0);
  await gladys.fake.setValue(device, feature('brightness'), 60);
  await gladys.fake.setValue(device, feature('color'), 0x00ff00);
  await gladys.fake.setValue(device, feature('white'), 154);
  await gladys.fake.setValue(device, feature('brightness'), 30);
  await gladys.fake.setValue(device, feature('brightness'), 0);
  assert.deepEqual(net.posts, [
    { action: 'off' },
    { action: 'on', color: '191;90;60' },
    { action: 'on', color: '120;100;60' },
    { action: 'on', color: '18;60' },
    { action: 'on', color: '18;30' },
    { action: 'off' },
  ]);
  const posts = net.calls.filter((c) => c.method === 'POST');
  assert.equal(posts[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(
    posts.map((c) => c.body),
    [
      'action=off',
      'action=on&color=191;90;60',
      'action=on&color=120;100;60',
      'action=on&color=18;60',
      'action=on&color=18;30',
      'action=off',
    ],
  );
  await app.publisher.flush();
  assert.equal(gladys.fake.lastState(feature('white').external_id), monoToMireds(18));
  assert.equal(gladys.fake.lastState(feature('light').external_id), 0);
});

test('a mono bulb keeps its white when dimmed', async (t) => {
  const net = network();
  net.devices['192.168.1.31'].routes[`GET /api/v1/device/${BULB_MAC}`] = BULB_MONO_STATE;
  const { gladys } = await setup(t, { net });
  await createAll(gladys);
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === id(BULB_MAC));
  const brightness = device.features.find((f) => f.external_id === id(BULB_MAC, 'brightness'));
  await gladys.fake.setValue(device, brightness, 50);
  assert.deepEqual(net.posts, [{ action: 'on', color: '10;50' }]);
});

test('the API token goes in the Token header, a refusal shows in the status', async (t) => {
  const net = network({ token: 'right-token' });
  const { gladys, logs } = await setup(t, {
    net,
    config: { addresses: '192.168.1.30', api_token: 'wrong-token' },
  });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Token refused by 192\.168\.1\.30/);
  await gladys.fake.configUpdated({ addresses: '192.168.1.30', api_token: 'right-token' });
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(net.calls.at(-1).headers.Token, 'right-token');
  assert.ok(logs.every((line) => !line.includes('right-token') && !line.includes('wrong-token')));
});

test('an unreachable device: badge, status, then back', async (t) => {
  const net = network();
  const { gladys, app } = await setup(t, { net });
  await createAll(gladys);
  const pir = net.devices['192.168.1.33'];
  delete net.devices['192.168.1.33'];
  await app.poll();
  app.updateStatus();
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: id('083A8D0A0B0C'),
    transport: 'unreachable',
  });
  assert.match(gladys.fake.connectionStatus.message.en, /3 of 4/);
  net.devices['192.168.1.33'] = pir;
  await app.poll();
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
});

test('the energy index survives a restart of the integration and of the switch', async (t) => {
  const store = new MemoryStore();
  const net = network();
  const first = await setup(t, { store, net, config: { addresses: '192.168.1.30' } });
  await first.app.stop();
  const report = net.devices['192.168.1.30'].routes;
  report['GET /report'] = () => ({ ...SWITCH_REPORT, boot_id: 'NEW', energy_since_boot: 360_000 });
  const second = await setup(t, { store, net, config: { addresses: '192.168.1.30' } });
  await createAll(second.gladys);
  await second.app.publisher.flush();
  assert.equal(second.gladys.fake.lastState(id('64002D010203', 'energy')), 2.1);
});

test('find the devices: UDP announcements, a sleeping button kept, the receiver started', async (t) => {
  const { gladys, app, channels, net } = await setup(t, {
    config: { api_token: 'user-token' },
    containers: [{ name: 'mystrom-buttons', status: 'running', ports: [] }],
    scanResults: {
      'udp-broadcast': [
        announcement('64002D010203', 107, '192.168.1.30'),
        announcement(BUTTON_MAC, 104, '192.168.1.40'),
      ],
    },
  });
  const ack = await gladys.fake.action('find_devices');
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Switch Switch EU 64002D010203 \(192\.168\.1\.30\)/);
  assert.match(ack.data.message.fr, /Bouton Button 5CCF7F02D676 \(192\.168\.1\.40\)/);
  assert.deepEqual(gladys.fake.scans, [{ type: 'udp-broadcast', timeout_seconds: 7 }]);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const [start] = gladys.fake.bodies('POST', '/container/mystrom-buttons/start');
  assert.deepEqual(Object.keys(start.env).sort(), [
    'BUTTON_TOKEN',
    'CHANNEL_PORT',
    'CHANNEL_TOKEN',
    'HTTP_PORT',
  ]);
  assert.equal(start.env.BUTTON_TOKEN, app.data.tokens.button);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].options.host, 'mystrom-buttons');
  assert.equal(channels[0].started, true);
  // A machine announcing itself is first asked without the token.
  const first = net.calls.find((c) => c.host === '192.168.1.30');
  assert.equal(first.headers.Token, undefined);
});

test('the channel opens only once Gladys shows the receiver running', async (t) => {
  const { gladys, app, channels } = await setup(t, {
    config: {},
    containers: [],
    scanResults: { 'udp-broadcast': [announcement(BUTTON_MAC, 104, '192.168.1.40')] },
  });
  await gladys.fake.action('find_devices');
  assert.equal(gladys.fake.bodies('POST', '/container/mystrom-buttons/start').length, 1);
  assert.equal(channels.length, 0, 'not running: no channel');
  gladys.fake.containers = [{ name: 'mystrom-buttons', status: 'running', ports: [] }];
  app.lastReceiverTry = -Infinity;
  await app.tick();
  assert.equal(channels.length, 1);
});

test('a secured device announcing itself gets the token only once it asks for it', async (t) => {
  const net = network({ token: 'user-token' });
  const { gladys } = await setup(t, {
    net,
    config: { api_token: 'user-token' },
    scanResults: { 'udp-broadcast': [announcement('64002D010203', 107, '192.168.1.30')] },
  });
  await gladys.fake.action('find_devices');
  const asks = net.calls.filter((c) => c.host === '192.168.1.30' && c.path === '/api/v1/info');
  assert.deepEqual(
    asks.map((c) => c.headers.Token),
    [undefined, 'user-token'],
  );
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('another device at a known address: never polled as the old one, searched again', async (t) => {
  const net = network();
  const { gladys, app } = await setup(t, { net, config: { addresses: '192.168.1.30' } });
  await createAll(gladys);
  // DHCP gives the switch address to the motion sensor.
  net.devices['192.168.1.30'] = net.devices['192.168.1.33'];
  app.verified.clear();
  const scansBefore = gladys.fake.scans.length;
  const callsBefore = net.calls.length;
  await app.poll();
  await app.publishDevices();
  app.updateStatus();
  const sw = app.data.devices['64002D010203'];
  assert.equal(sw.address, '', 'the switch is no longer at that address');
  assert.equal(app.data.devices['083A8D0A0B0C'].address, '192.168.1.30');
  assert.ok(gladys.fake.scans.length > scansBefore, 'a search was started');
  assert.ok(
    !net.calls.slice(callsBefore).some((c) => c.path === '/report'),
    'no /report read from the other device',
  );
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: id('64002D010203'),
    transport: 'unreachable',
  });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Two devices at 192\.168\.1\.30: 64002D010203 was known there, 083A8D0A0B0C answers now/,
  );
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === id('64002D010203'));
  const relay = device.features.find((f) => f.external_id.endsWith(':switch'));
  assert.equal((await gladys.fake.setValue(device, relay, 1)).success, false);
});

test('a device without address is searched again, at most every 5 minutes', async (t) => {
  const net = network();
  let time = 10_000_000;
  const { gladys, app } = await setup(t, { net, config: { addresses: '192.168.1.30' } });
  app.now = () => time;
  // Found by a search, not typed: only a new search can find it again.
  app.config.addresses = [];
  app.data.devices['64002D010203'].address = '';
  app.lastSearch = time - 5 * 60_000;
  const scans = () => gladys.fake.scans.length;
  const before = scans();
  await app.tick();
  await app.discovering;
  assert.equal(scans(), before + 1, 'searched');
  time += 60_000;
  await app.tick();
  await app.discovering;
  assert.equal(scans(), before + 1, 'not again within 5 minutes');
  time += 4 * 60_000;
  await app.tick();
  await app.discovering;
  assert.equal(scans(), before + 2, 'again after 5 minutes');
  app.data.devices['64002D010203'].address = '192.168.1.30';
  time += 10 * 60_000;
  await app.tick();
  assert.equal(scans(), before + 2, 'nothing lost, no search');
});

test('a command checks the device first when the check is old', async (t) => {
  const net = network();
  let time = 1_000_000;
  const { gladys, app } = await setup(t, { net, config: { addresses: '192.168.1.30' } });
  app.now = () => time;
  await createAll(gladys);
  const device = gladys.fake.discoveredDevices[0];
  const relay = device.features.find((f) => f.external_id.endsWith(':switch'));
  app.verified.set('64002D010203', time);
  time += 11 * 60_000;
  net.calls.length = 0;
  await gladys.fake.setValue(device, relay, 0);
  assert.deepEqual(net.calls.map((c) => c.path).slice(0, 2), ['/api/v1/info', '/relay?state=0']);
});

test('find the devices: an old Gladys without the scan', async (t) => {
  const { gladys, app } = await setup(t, { config: {} });
  app.gladys.scanNetwork = async () => {
    throw new Error('404 Not Found');
  };
  const ack = await gladys.fake.action('find_devices');
  assert.match(ack.data.message.en, /The search failed \(404 Not Found\)/);
  const none = await setup(t, { config: {} });
  assert.match((await none.gladys.fake.action('find_devices')).data.message.en, /No myStrom/);
});

const BUTTONS = {
  '192.168.1.40': { routes: { 'GET /api/v1/info': BUTTON_INFO } },
  '192.168.1.41': { routes: { 'GET /api/v1/info': BUTTON_PLUS_INFO } },
};

async function withButtons(t, { config: extra, ...options } = {}) {
  const net = network();
  Object.assign(net.devices, structuredClone(BUTTONS));
  const buttonPosts = [];
  for (const [host, mac] of [
    ['192.168.1.40', BUTTON_MAC],
    ['192.168.1.41', BUTTON_PLUS_MAC],
  ]) {
    net.devices[host].routes[`POST /api/v1/device/${mac}`] = ({ body }) => {
      buttonPosts.push({ host, form: Object.fromEntries(new URLSearchParams(body)) });
      return {};
    };
  }
  const context = await setup(t, {
    net,
    config: {
      addresses: '192.168.1.40, 192.168.1.41',
      callback_address: '192.168.1.10',
      ...extra,
    },
    containers: [
      {
        name: 'mystrom-buttons',
        status: 'running',
        ports: [{ container_port: 8080, protocol: 'tcp', name: 'buttons', host_port: 42115 }],
      },
    ],
    ...options,
  });
  return { ...context, buttonPosts };
}

test('set the button action URLs: every press of every button points to the receiver', async (t) => {
  const { gladys, app, buttonPosts, net } = await withButtons(t);
  const ack = await gladys.fake.action('setup_buttons');
  assert.match(ack.data.message.en, /Action URLs set on: Button 5CCF7F02D676, Button Plus/);
  const base = `get://192.168.1.10:42115/press/${app.data.tokens.button}`;
  assert.deepEqual(buttonPosts, [
    {
      host: '192.168.1.40',
      form: {
        single: `${base}/${BUTTON_MAC}/single`,
        double: `${base}/${BUTTON_MAC}/double`,
        long: `${base}/${BUTTON_MAC}/long`,
      },
    },
    {
      host: '192.168.1.41',
      form: {
        single: `${base}/${BUTTON_PLUS_MAC}/single`,
        double: `${base}/${BUTTON_PLUS_MAC}/double`,
        long: `${base}/${BUTTON_PLUS_MAC}/long`,
        touch: `${base}/${BUTTON_PLUS_MAC}/touch`,
      },
    },
  ]);
  // The exact body: the URL in clear, as the button firmware reads it.
  const body = net.calls.find((c) => c.method === 'POST' && c.host === '192.168.1.40').body;
  assert.equal(
    body,
    `single=${base}/${BUTTON_MAC}/single&double=${base}/${BUTTON_MAC}/double&long=${base}/${BUTTON_MAC}/long`,
  );
  assert.ok(body.startsWith('single=get://192.168.1.10:42115/press/'));
});

test('start: the Gladys address saved by 0.1.3 is copied once into the new field', async (t) => {
  const legacy = await setup(t, { config: { GLADYS_ADDRESS: '192.168.1.10' } });
  assert.deepEqual(legacy.gladys.fake.bodies('POST', '/config'), [
    { config: { callback_address: '192.168.1.10' } },
  ]);
  assert.equal(legacy.gladys.fake.config.callback_address, '192.168.1.10');
  assert.equal(legacy.app.config.gladysHost, '192.168.1.10');
  assert.ok(legacy.logs.some((line) => line.startsWith('info ') && /copied into/.test(line)));
  assert.ok(
    legacy.logs.every((line) => !line.includes('192.168.1.10')),
    'the value is not logged',
  );
  // The next start reads the migrated config: nothing to copy any more.
  await legacy.app.start(await legacy.gladys.getConfig());
  assert.equal(legacy.gladys.fake.bodies('POST', '/config').length, 1);

  // The field cleared by the user: no fallback, nothing written.
  const cleared = await setup(t, {
    config: { callback_address: '', GLADYS_ADDRESS: '192.168.1.10' },
  });
  assert.equal(cleared.gladys.fake.bodies('POST', '/config').length, 0);
  assert.equal(cleared.app.config.gladysHost, '');
});

test('set the button action URLs: no Gladys address, no button, a button asleep', async (t) => {
  const noAddress = await withButtons(t, { config: { callback_address: '' } });
  assert.match(
    (await noAddress.gladys.fake.action('setup_buttons')).data.message.en,
    /IP address of the Gladys machine/,
  );
  const badAddress = await withButtons(t, { config: { callback_address: 'http://x:80/' } });
  assert.match(
    (await badAddress.gladys.fake.action('setup_buttons')).data.message.fr,
    /n'est pas une adresse IP valide/,
  );
  const noButton = await setup(t, { config: { callback_address: '192.168.1.10' } });
  assert.match(
    (await noButton.gladys.fake.action('setup_buttons')).data.message.fr,
    /Aucun bouton myStrom connu/,
  );
  const asleep = await withButtons(t);
  delete asleep.net.devices['192.168.1.41'];
  const message = (await asleep.gladys.fake.action('setup_buttons')).data.message;
  assert.match(message.en, /Not reached: Button Plus 5CCF7F02D677\. A button only listens/);
});

test('a press: the button feature and the scene trigger, stale and unknown ones dropped', async (t) => {
  const { gladys, app, channels } = await withButtons(t);
  await createAll(gladys);
  const [channel] = channels;
  assert.ok(channel, 'the receiver channel opens once a button is known');
  const at = new Date().toISOString();
  channel.emit('message', { type: 'press', mac: BUTTON_MAC, press: 'double', at });
  channel.emit('message', { type: 'press', mac: BUTTON_MAC, press: 'double', at });
  channel.emit('message', { type: 'press', mac: BUTTON_PLUS_MAC, press: 'touch', at });
  channel.emit('message', {
    type: 'press',
    mac: BUTTON_MAC,
    press: 'single',
    at: new Date(Date.now() - 5 * 60_000).toISOString(),
  });
  channel.emit('message', { type: 'press', mac: 'AABBCCDDEEFF', press: 'single', at });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gladys.fake.sceneEvents, [
    { key: 'button_pressed', data: { device: id(BUTTON_MAC), press: 'double' } },
    { key: 'button_pressed', data: { device: id(BUTTON_MAC), press: 'double' } },
    { key: 'button_pressed', data: { device: id(BUTTON_PLUS_MAC), press: 'touch' } },
  ]);
  await app.publisher.flush();
  assert.equal(gladys.fake.lastState(id(BUTTON_MAC, 'button')), 2);
  assert.equal(gladys.fake.lastState(id(BUTTON_PLUS_MAC, 'button')), 60);
});

test('the receiver is started again only when its environment changed', async (t) => {
  const store = new MemoryStore();
  const first = await withButtons(t, { store });
  assert.equal(first.gladys.fake.bodies('POST', '/container/mystrom-buttons/start').length, 1);
  await first.app.stop();
  const second = await withButtons(t, { store });
  assert.equal(second.gladys.fake.bodies('POST', '/container/mystrom-buttons/start').length, 0);
  assert.equal(second.app.data.tokens.button, first.app.data.tokens.button, 'tokens kept');
});

test('a device moving to another address keeps its Gladys device', async (t) => {
  const net = network();
  net.devices['192.168.1.99'] = net.devices['192.168.1.30'];
  const { gladys, app } = await setup(t, { net, config: { addresses: '192.168.1.30' } });
  await gladys.fake.configUpdated({ addresses: '192.168.1.99' });
  const devices = gladys.fake.discoveredDevices;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].external_id, id('64002D010203'));
  assert.equal(devices[0].params.find((p) => p.name === 'IP_ADDRESS').value, '192.168.1.99');
  assert.equal(app.data.devices['64002D010203'].address, '192.168.1.99');
});

test('junk in the configuration and devices that are not myStrom', async (t) => {
  const net = network();
  net.devices['192.168.1.50'] = {
    routes: { 'GET /api/v1/info': { mac: 'AABBCCDDEEFF', type: 113 } },
  };
  const { gladys } = await setup(t, { net, config: { addresses: 'oops_, 192.168.1.50' } });
  const { message, connected } = gladys.fake.connectionStatus;
  assert.equal(connected, false);
  assert.match(message.en, /Ignored, not an address: oops_\./);
  assert.match(message.fr, /Pas un appareil myStrom pris en charge : 192\.168\.1\.50\./);
});
