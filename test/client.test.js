// -----------------------------------------------------------------------------
// The HTTP client of the myStrom local API, against a fake fetch.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MyStromClient, encodeForm, normalizeMac } from '../src/mystrom/client.js';
import { SWITCH_V1_INFO, fakeFetch } from './fixtures/mystrom.js';

const TOKEN_404 = { kind: 'auth', status: 404, message: 'token missing or refused (HTTP 404)' };

test('info: /api/v1/info, else /info.json on old firmware', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '192.168.1.30': { routes: { 'GET /info.json': SWITCH_V1_INFO } },
  });
  const client = new MyStromClient({ fetchImpl });
  assert.deepEqual(await client.info('192.168.1.30'), SWITCH_V1_INFO);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/api/v1/info', '/info.json'],
  );
});

test('a secured device answers 404 without its token: a token error, on every read', async () => {
  const { fetchImpl, calls } = fakeFetch({
    '10.0.0.7': {
      token: 'secret-of-the-device',
      routes: {
        'GET /api/v1/info': { mac: '64002D010203', type: 107 },
        'GET /report': { relay: true },
        'GET /api/v1/sensors': { motion: false },
        'GET /api/v1/device/5CCF7FA0C27C': { '5CCF7FA0C27C': { on: true } },
        'POST /api/v1/device/5CCF7FA0C27C': {},
      },
    },
  });
  const client = new MyStromClient({ fetchImpl });
  await assert.rejects(client.info('10.0.0.7'), TOKEN_404);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/api/v1/info', '/info.json'],
    'both paths tried before blaming the token',
  );
  await assert.rejects(client.report('10.0.0.7'), TOKEN_404);
  await assert.rejects(client.pirSensors('10.0.0.7'), TOKEN_404);
  await assert.rejects(client.deviceState('10.0.0.7', '5CCF7FA0C27C'), TOKEN_404);
  await assert.rejects(client.setDevice('10.0.0.7', '5CCF7FA0C27C', { action: 'on' }), TOKEN_404);
  await assert.rejects(client.setRelay('10.0.0.7', true), TOKEN_404);
  assert.deepEqual(await client.report('10.0.0.7', 'secret-of-the-device'), { relay: true });
  assert.equal(calls.at(-1).headers.Token, 'secret-of-the-device');
});

test('errors: unreachable, 401, HTTP error, timeout, huge answer', async () => {
  const { fetchImpl } = fakeFetch({
    '10.0.0.2': { token: 't', tokenStatus: 401, routes: { 'GET /report': {} } },
    '10.0.0.3': { routes: { 'GET /relay': { error: 1 } } },
    '10.0.0.4': { routes: { 'GET /report': 'x'.repeat(70_000) } },
  });
  const client = new MyStromClient({ fetchImpl });
  await assert.rejects(client.report('10.0.0.1'), { kind: 'unreachable' });
  await assert.rejects(client.report('10.0.0.2'), { kind: 'auth', status: 401 });
  assert.deepEqual(await client.report('10.0.0.2', 't'), {});
  await assert.rejects(client.report('10.0.0.4'), { kind: 'invalid' });
  const slow = new MyStromClient({
    timeout: 20,
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  await assert.rejects(slow.report('10.0.0.5'), { kind: 'timeout' });
});

test('a device state is the entry of its MAC, never another one', async () => {
  const { fetchImpl } = fakeFetch({
    '10.0.0.6': {
      routes: {
        'GET /api/v1/device/5CCF7FA0C27C': { '5CCF7FA0C27C': { on: true } },
        'GET /api/v1/device/5CCF7FA0C2AA': { '5CCF7FA0C27C': { on: true } },
      },
    },
  });
  const client = new MyStromClient({ fetchImpl });
  assert.deepEqual(await client.deviceState('10.0.0.6', '5CCF7FA0C27C'), { on: true });
  await assert.rejects(client.deviceState('10.0.0.6', '5CCF7FA0C2AA'), { kind: 'invalid' });
});

test('form bodies: percent-encoded, with ; : / in clear as the firmware reads them', async () => {
  assert.equal(encodeForm({ action: 'on', color: '120;100;50' }), 'action=on&color=120;100;50');
  assert.equal(
    encodeForm({ single: 'get://192.168.1.10:42115/press/ab-c_d/5CCF7F02D676/single' }),
    'single=get://192.168.1.10:42115/press/ab-c_d/5CCF7F02D676/single',
  );
  assert.equal(encodeForm({ a: 'x&y=z %' }), 'a=x%26y%3Dz%20%25');
  const { fetchImpl, calls } = fakeFetch({
    '10.0.0.8': { routes: { 'POST /api/v1/device/5CCF7FA0C27C': {} } },
  });
  await new MyStromClient({ fetchImpl }).setDevice('10.0.0.8', '5CCF7FA0C27C', {
    action: 'on',
    color: '120;100;50',
  });
  assert.equal(calls[0].body, 'action=on&color=120;100;50');
  assert.equal(calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('IPv6 addresses go between brackets', async () => {
  const { fetchImpl, calls } = fakeFetch({ '[fe80::1]': { routes: { 'GET /report': {} } } });
  await new MyStromClient({ fetchImpl }).report('[fe80::1]');
  assert.equal(calls[0].host, '[fe80::1]');
});

test('MAC addresses', () => {
  assert.equal(normalizeMac('5c:cf:7f:a0:c2:7c'), '5CCF7FA0C27C');
  assert.equal(normalizeMac('5CCF7FA0C2'), undefined);
  assert.equal(normalizeMac(undefined), undefined);
});
