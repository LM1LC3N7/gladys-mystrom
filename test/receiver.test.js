// -----------------------------------------------------------------------------
// The button receiver of the sub-container: the press URLs (pure), then the
// service over loopback (127.0.0.1 only, ephemeral ports) with a channel
// client like the main container's.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { ChannelClient } from '../src/channel.js';
import { parsePress, startButtonService } from '../src/buttons/service.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

test('press URLs: token, MAC, known presses only', () => {
  assert.deepEqual(parsePress(`/press/${TOKEN}/5ccf7f02d676/single`, TOKEN), {
    mac: '5CCF7F02D676',
    press: 'single',
  });
  assert.deepEqual(parsePress(`/press/${TOKEN}/5CCF7F02D676/touch/?x=1`, TOKEN), {
    mac: '5CCF7F02D676',
    press: 'touch',
  });
  assert.equal(
    parsePress(`/press/${TOKEN.replace('a', 'b')}/5CCF7F02D676/single`, TOKEN),
    undefined,
  );
  assert.equal(parsePress(`/press/${TOKEN}/5CCF7F02D676/wheel`, TOKEN), undefined);
  assert.equal(parsePress(`/press/${TOKEN}/5CCF7F02D67/single`, TOKEN), undefined);
  assert.equal(parsePress(`/press/${TOKEN}/5CCF7F02D676/single`, ''), undefined, 'no token');
  assert.equal(parsePress('/', TOKEN), undefined);
});

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the service: presses reach the main container, kept while it is away', async (t) => {
  const service = await startButtonService({
    env: {
      BUTTON_TOKEN: TOKEN,
      CHANNEL_TOKEN: 'channel-secret',
      HTTP_PORT: '0',
      HTTP_HOST: '127.0.0.1',
      CHANNEL_PORT: '0',
    },
  });
  t.after(() => service.stop());
  // Pressed before the main container connects: kept.
  assert.equal(await get(service.port, `/press/${TOKEN}/5CCF7F02D676/long`), 200);
  assert.equal(await get(service.port, `/press/wrong-token-wrong-token/5CCF7F02D676/long`), 404);

  const client = new ChannelClient({
    host: '127.0.0.1',
    port: service.channel.port,
    token: 'channel-secret',
    delays: [50],
  });
  const messages = [];
  client.on('message', (message) => messages.push(message));
  t.after(() => client.stop());
  client.start();
  await once(client, 'up');
  assert.equal(await get(service.port, `/press/${TOKEN}/5CCF7F02D676/single`), 200);
  while (messages.length < 2) {
    await once(client, 'message');
  }
  assert.deepEqual(
    messages.map(({ type, mac, press }) => ({ type, mac, press })),
    [
      { type: 'press', mac: '5CCF7F02D676', press: 'long' },
      { type: 'press', mac: '5CCF7F02D676', press: 'single' },
    ],
  );
  assert.ok(messages.every((message) => !Number.isNaN(Date.parse(message.at))));
});

test('the channel refuses a client without the right token', async (t) => {
  const service = await startButtonService({
    env: {
      BUTTON_TOKEN: TOKEN,
      CHANNEL_TOKEN: 'channel-secret',
      HTTP_PORT: '0',
      HTTP_HOST: '127.0.0.1',
      CHANNEL_PORT: '0',
    },
  });
  t.after(() => service.stop());
  const client = new ChannelClient({
    host: '127.0.0.1',
    port: service.channel.port,
    token: 'not-it',
    delays: [10_000],
  });
  t.after(() => client.stop());
  let up = false;
  client.on('up', () => {
    up = true;
  });
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(up, false);
  assert.equal(service.channel.connected, false);
});
