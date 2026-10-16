// -----------------------------------------------------------------------------
// The button receiver of the sub-container: the press URLs (pure), then the
// service over loopback (127.0.0.1 only, ephemeral ports) with a channel
// client like the main container's.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { ChannelClient, createChannelServer, proof } from '../src/channel.js';
import { parsePress, startButtonService } from '../src/buttons/service.js';

/** Reads JSON lines from a socket. */
function lines(socket) {
  const received = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      received.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });
  return received;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('channel handshake: the secret never goes on the wire, both sides prove it', async (t) => {
  const server = createChannelServer({ port: 0, host: '127.0.0.1', token: 'channel-secret' });
  await server.start();
  t.after(() => server.stop());
  server.send({ type: 'press', mac: '5CCF7F02D676', press: 'single' });
  const socket = createConnection({ host: '127.0.0.1', port: server.port });
  t.after(() => socket.destroy());
  const received = lines(socket);
  await once(socket, 'connect');
  while (received.length === 0) await wait(5);
  const [challenge] = received;
  assert.equal(challenge.type, 'challenge');
  assert.match(challenge.nonce, /^[0-9a-f]{32}$/);
  const clientNonce = 'a'.repeat(32);
  socket.write(
    `${JSON.stringify({
      type: 'hello',
      nonce: clientNonce,
      proof: proof('channel-secret', 'client', challenge.nonce, clientNonce),
    })}\n`,
  );
  while (received.length < 3) await wait(5);
  assert.equal(received[1].type, 'ready');
  assert.equal(received[1].proof, proof('channel-secret', 'server', clientNonce, challenge.nonce));
  assert.equal(received[2].type, 'press', 'the queue only after the handshake');
  assert.ok(!JSON.stringify(received).includes('channel-secret'));
});

test('channel: a replayed or forged hello is refused, nothing is sent to it', async (t) => {
  const server = createChannelServer({ port: 0, host: '127.0.0.1', token: 'channel-secret' });
  await server.start();
  t.after(() => server.stop());
  server.send({ type: 'press', mac: '5CCF7F02D676', press: 'single' });
  const socket = createConnection({ host: '127.0.0.1', port: server.port });
  t.after(() => socket.destroy());
  const received = lines(socket);
  await once(socket, 'connect');
  while (received.length === 0) await wait(5);
  // A proof computed for another challenge (a recorded exchange).
  socket.write(
    `${JSON.stringify({
      type: 'hello',
      nonce: 'b'.repeat(32),
      proof: proof('channel-secret', 'client', 'c'.repeat(32), 'b'.repeat(32)),
    })}\n`,
  );
  await once(socket, 'close');
  assert.deepEqual(
    received.map((m) => m.type),
    ['challenge'],
  );
  assert.equal(server.connected, false);
});

test('channel client: nothing accepted from a receiver that cannot prove the secret', async (t) => {
  // An impostor on the private network: it challenges, then sends a ready
  // without the right proof, and a press.
  const impostor = createServer((socket) => {
    socket.write(`${JSON.stringify({ type: 'challenge', nonce: 'd'.repeat(32) })}\n`);
    socket.once('data', () => {
      socket.write(`${JSON.stringify({ type: 'ready', proof: 'nope' })}\n`);
      socket.write(`${JSON.stringify({ type: 'press', mac: '5CCF7F02D676', press: 'long' })}\n`);
    });
  });
  await new Promise((resolve) => impostor.listen(0, '127.0.0.1', resolve));
  t.after(() => impostor.close());
  const client = new ChannelClient({
    host: '127.0.0.1',
    port: impostor.address().port,
    token: 'channel-secret',
    delays: [10_000],
  });
  t.after(() => client.stop());
  const events = [];
  client.on('up', () => events.push('up'));
  client.on('message', (message) => events.push(message.type));
  client.start();
  await wait(200);
  assert.deepEqual(events, []);
  // And a press sent before any ready is not accepted either.
  const early = createServer((socket) => {
    socket.write(`${JSON.stringify({ type: 'press', mac: '5CCF7F02D676', press: 'long' })}\n`);
  });
  await new Promise((resolve) => early.listen(0, '127.0.0.1', resolve));
  t.after(() => early.close());
  const second = new ChannelClient({
    host: '127.0.0.1',
    port: early.address().port,
    token: 'channel-secret',
    delays: [10_000],
  });
  t.after(() => second.stop());
  second.on('message', (message) => events.push(message.type));
  second.start();
  await wait(200);
  assert.deepEqual(events, []);
});

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
