// -----------------------------------------------------------------------------
// The HTTP client of the myStrom local API, against a fake fetch.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MyStromClient, normalizeMac } from '../src/mystrom/client.js';
import { SWITCH_V1_INFO, fakeFetch } from './fixtures/mystrom.js';

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

test('errors: unreachable, refused token, HTTP error, timeout, huge answer', async () => {
  const { fetchImpl } = fakeFetch({
    '10.0.0.2': { token: 't', routes: { 'GET /report': {} } },
    '10.0.0.3': { routes: {} },
    '10.0.0.4': { routes: { 'GET /report': 'x'.repeat(70_000) } },
  });
  const client = new MyStromClient({ fetchImpl });
  await assert.rejects(client.report('10.0.0.1'), { kind: 'unreachable' });
  await assert.rejects(client.report('10.0.0.2'), { kind: 'auth', status: 401 });
  assert.deepEqual(await client.report('10.0.0.2', 't'), {});
  await assert.rejects(client.report('10.0.0.3'), { kind: 'http', status: 404 });
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

test('a device state is the entry of its MAC', async () => {
  const { fetchImpl } = fakeFetch({
    '10.0.0.6': {
      routes: { 'GET /api/v1/device/5CCF7FA0C27C': { '5CCF7FA0C27C': { on: true } } },
    },
  });
  const client = new MyStromClient({ fetchImpl });
  assert.deepEqual(await client.deviceState('10.0.0.6', '5CCF7FA0C27C'), { on: true });
});

test('MAC addresses', () => {
  assert.equal(normalizeMac('5c:cf:7f:a0:c2:7c'), '5CCF7FA0C27C');
  assert.equal(normalizeMac('5CCF7FA0C2'), undefined);
  assert.equal(normalizeMac(undefined), undefined);
});
