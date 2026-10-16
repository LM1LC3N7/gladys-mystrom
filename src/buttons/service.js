// -----------------------------------------------------------------------------
// The service of the `mystrom-buttons` sub-container: the HTTP endpoint the
// myStrom buttons call (their "action URL"), and the channel that hands each
// press to the main container. The main container cannot publish a port, this
// container does (Gladys picks the host port).
//
// A button calls GET http://<Gladys>:<port>/press/<token>/<MAC>/<press>: the
// button adds nothing to the URL it was given, so the URL itself names the
// button and the press. The token (set by the main container) keeps another
// machine of the network from firing the scenes by guessing the URL.
//
// Environment, set by the main container through startContainer:
//   BUTTON_TOKEN   the secret of the action URLs
//   CHANNEL_TOKEN  the secret the main container says hello with
//   HTTP_PORT      8080 (published by Gladys)
//   CHANNEL_PORT   7778 (private network only)
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createChannelServer } from '../channel.js';
import { PRESSES, RECEIVER } from '../constants.js';

const PATH = /^\/press\/([A-Za-z0-9_-]{16,128})\/([0-9A-Fa-f]{12})\/([a-z]{1,10})\/?$/;
/** Presses accepted per minute, all buttons together (a button presses far less). */
const PER_MINUTE = 300;

const sameToken = (a, b) => {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

/**
 * The press of a request URL, undefined when the URL is not a press URL with the right token.
 * @returns {{ mac: string, press: string } | undefined}
 */
export function parsePress(url, token) {
  let path;
  try {
    path = new URL(String(url ?? ''), 'http://receiver').pathname;
  } catch {
    return undefined;
  }
  const match = PATH.exec(path);
  if (!match || !sameToken(match[1], token) || !PRESSES.includes(match[3])) {
    return undefined;
  }
  return { mac: match[2].toUpperCase(), press: match[3] };
}

/**
 * @returns {Promise<{ http, channel, stop(): Promise, port: number }>}
 */
export async function startButtonService({ env = process.env, logger, now = Date.now } = {}) {
  const buttonToken = env.BUTTON_TOKEN ?? '';
  if (buttonToken.length < 16) {
    logger?.warn('BUTTON_TOKEN is missing: every press will be refused');
  }
  const channel = createChannelServer({
    port: Number(env.CHANNEL_PORT ?? RECEIVER.channelPort),
    token: env.CHANNEL_TOKEN,
    logger,
    queueSize: 100,
  });
  let window = [];
  const http = createServer((request, response) => {
    const press = parsePress(request.url, buttonToken);
    request.resume();
    if (!press) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const time = now();
    window = window.filter((t) => time - t < 60_000);
    if (window.length >= PER_MINUTE) {
      response.writeHead(429, { 'Content-Type': 'text/plain' }).end('Too many requests');
      return;
    }
    window.push(time);
    logger?.debug(`Button ${press.mac}: ${press.press}`);
    channel.send({ type: 'press', ...press, at: new Date(time).toISOString() });
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('OK');
  });
  http.requestTimeout = 10_000;
  http.headersTimeout = 10_000;
  await channel.start();
  await new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(Number(env.HTTP_PORT ?? RECEIVER.httpPort), env.HTTP_HOST ?? '0.0.0.0', () => {
      http.off('error', reject);
      resolve();
    });
  });
  const port = http.address().port;
  logger?.info(`Button receiver on HTTP port ${port}; channel on port ${channel.port}`);
  return {
    http,
    channel,
    port,
    async stop() {
      await new Promise((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
      await channel.stop();
    },
  };
}
