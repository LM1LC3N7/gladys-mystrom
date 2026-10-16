// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  ACTIONS,
  ANNOUNCE_PORT,
  POLL_INTERVAL,
  PRESSES,
  RECEIVER,
  SCENE_TRIGGERS,
} from '../src/constants.js';
import { CHANNEL_PORT } from '../src/channel.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers].flatMap((item) => item.fields ?? []),
];

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0', 'scene triggers need Gladys 5.1');
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-mystrom:${manifest.version}`);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+myStrom|sans\s+lien\s+avec\s+myStrom/i);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
});

test('the UDP announcements of the devices are the only capture', () => {
  assert.deepEqual(manifest.network_discovery, [{ type: 'udp-broadcast', ports: [ANNOUNCE_PORT] }]);
});

test('the button receiver sub-container: same image, its command, one HTTP port', () => {
  assert.equal(manifest.containers.length, 1);
  const [receiver] = manifest.containers;
  assert.equal(receiver.name, RECEIVER.name);
  assert.equal(receiver.docker_image, manifest.docker_image, 'released with the main image');
  assert.deepEqual(receiver.command, ['node', 'src/receiver.js']);
  assert.equal(receiver.start, 'manual', 'started by the app, with its env');
  assert.equal(receiver.read_only, true);
  assert.equal(receiver.env, undefined, 'the manifest is public: no secret here');
  assert.deepEqual(
    receiver.ports.map((port) => [port.container_port, port.protocol, port.name, port.browsable]),
    [[RECEIVER.httpPort, 'tcp', RECEIVER.httpPortName, false]],
  );
  assert.equal(RECEIVER.channelPort, CHANNEL_PORT, 'the channel port is never published');
  const names = receiver.ports.map((port) => port.name);
  for (const [, text] of texts(manifest.config_schema)) {
    for (const lang of ['en', 'fr']) {
      for (const [, name] of (text[lang] ?? '').matchAll(/\{\{port:([^}]+)\}\}/g)) {
        assert.ok(names.includes(name), `{{port:${name}}}`);
      }
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  assert.equal(fields.api_token.type, 'secret', 'the token is never sent back to the browser');
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max],
    [POLL_INTERVAL.min, POLL_INTERVAL.max],
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    assert.ok(!(section.key in DEFAULT_CONFIG), section.key);
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the actions are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('the scene trigger: its key, the presses, the device filter', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(SCENE_TRIGGERS),
  );
  const [trigger] = manifest.scene_triggers;
  const press = trigger.fields.find((f) => f.key === 'press');
  assert.deepEqual(
    press.options.map((o) => o.value),
    PRESSES,
  );
  const device = trigger.fields.find((f) => f.key === 'device');
  assert.equal(device.source, 'devices');
  assert.equal(device.options, undefined);
  assert.deepEqual(
    trigger.variables.map((v) => v.key),
    ['press'],
  );
});
