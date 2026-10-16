// -----------------------------------------------------------------------------
// The integration: the myStrom devices it knows, polled over their local REST
// API, the Gladys devices it builds from them, the commands sent back, the
// button presses relayed by the `mystrom-buttons` sub-container, and the
// configuration screen buttons. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ChannelClient } from './channel.js';
import { normalizeConfig, urlHost } from './config.js';
import { LIMITS, PRESS_VALUES, RECEIVER, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { nextEnergy } from './energy.js';
import { KIND_LABELS, T } from './i18n.js';
import {
  EXTERNAL_ID_TYPE,
  buildDevice,
  featureKeys,
  mergeCaps,
  readValues,
  specOf,
  switchCaps,
} from './model.js';
import { MyStromClient } from './mystrom/client.js';
import { parseAnnouncements, parseInfo } from './mystrom/info.js';
import { hsvColor, monoColor, parseLightState, rgbToHsv } from './mystrom/light.js';
import { StatePublisher } from './publisher.js';
import { FileStore, emptyData } from './store.js';

const hash = (object) => createHash('sha256').update(JSON.stringify(object)).digest('hex');
const secret = () => randomBytes(24).toString('base64url');
/** A press kept by the receiver while this container was away: no scene past this age. */
const STALE_PRESS = 60_000;

/** Runs `task` over `items`, `limit` at a time, in order. */
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class MyStromApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'mystrom' }),
    client = new MyStromClient(),
    store = new FileStore(),
    createChannel = (options) => new ChannelClient(options),
    now = Date.now,
    timers = globalThis,
    logLevel = process.env.LOG_LEVEL,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.client = client;
    this.store = store;
    this.createChannel = createChannel;
    this.now = now;
    this.timers = timers;
    this.logLevel = logLevel;
    this.config = normalizeConfig();
    this.data = undefined;
    this.publisher = new StatePublisher({
      gladys,
      logger,
      now,
      timers,
      interval: TIMINGS.measureInterval,
    });
    /** address -> { mac?, lastTry, error? }: what the typed addresses answered */
    this.probes = new Map();
    /** mac -> reachable */
    this.reachable = new Map();
    /** mac -> when the MAC answering at its address was last checked */
    this.verified = new Map();
    /** address -> [previous MAC, new MAC]: two devices seen at one address */
    this.conflicts = new Map();
    /** deviceId -> transport badge last published */
    this.transports = new Map();
    /** mac -> last parsed light state (the base of the next colour command) */
    this.lights = new Map();
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** featureId -> { mac, key } of the published devices */
    this.features = new Map();
    this.eventWindow = [];
    this.polling = undefined;
    this.discovering = undefined;
    this.lastSearch = -Infinity;
    this.lastReceiverTry = -Infinity;
    this.pollTimer = undefined;
    this.persistTimer = undefined;
    this.channel = undefined;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    if (!this.data) {
      this.data = await this.store.load().catch(() => emptyData());
      this.data.tokens.button ||= secret();
      this.data.tokens.channel ||= secret();
      this.persist();
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (previous.token !== this.config.token) {
      // Another token: the addresses that refused the previous one are asked again.
      this.probes.clear();
    }
    this.refreshCreated();
    this.publisher.start();
    this.transports.clear();
    this.started = true;
    await this.poll();
    await this.publishDevices();
    await this.publishAllTransports();
    this.schedule();
    await this.startReceiver();
    this.updateStatus();
  }

  stop() {
    this.started = false;
    this.publisher.stop();
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.channel?.stop();
    this.channel = undefined;
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      return this.store.save(this.data).catch(() => {});
    }
    return Promise.resolve();
  }

  schedule() {
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = this.timers.setInterval(() => this.tick(), this.config.pollInterval * 1000);
  }

  /** One timer round: polling, and the receiver channel when it is not open yet. */
  tick() {
    return this.poll()
      .then((changed) => (changed ? this.publishDevices() : undefined))
      .then(() => {
        if (!this.channel && this.now() - this.lastReceiverTry >= TIMINGS.probeRetry) {
          return this.startReceiver();
        }
        return undefined;
      })
      .then(() => this.updateStatus())
      .catch((err) => this.logger.warn(`Polling failed: ${err.message}`));
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.store
        .save(this.data)
        .catch((err) => this.logger.warn(`Could not save /data: ${err.message}`));
    }, TIMINGS.persistDelay);
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  get records() {
    return Object.values(this.data?.devices ?? {});
  }

  // --- Known devices -----------------------------------------------------------

  /** Adds or updates a known device; true when the Gladys device changes. */
  remember(identity, address, extra = {}) {
    const devices = this.data.devices;
    const existing = devices[identity.mac];
    if (!existing && Object.keys(devices).length >= LIMITS.devices) {
      this.warnOnce('devices', `More than ${LIMITS.devices} devices: the next ones are ignored`);
      return false;
    }
    let changed = false;
    // One address, one device: another device known at this address has moved.
    for (const other of this.records) {
      if (other.mac !== identity.mac && other.address === address) {
        this.logger.warn(
          `Two devices at ${address}: ${other.mac} was known there, ${identity.mac} answers now`,
        );
        this.conflicts.set(address, [other.mac, identity.mac]);
        other.address = '';
        this.setReachable(other, false, 'moved');
        this.requestSearch();
        changed = true;
      }
    }
    const record = {
      ...existing,
      mac: identity.mac,
      typeId: identity.typeId,
      kind: identity.kind,
      model: identity.model,
      touch: identity.touch,
      firmware: identity.firmware || existing?.firmware || '',
      name: identity.name || existing?.name || '',
      address,
      ...extra,
    };
    if (JSON.stringify(existing) !== JSON.stringify(record)) {
      devices[identity.mac] = record;
      changed = true;
      if (existing && existing.address !== address) {
        this.logger.info(`${identity.model} ${identity.mac} is now at ${address}`);
        for (const [conflict, macs] of this.conflicts) {
          if (macs[0] === identity.mac) {
            this.conflicts.delete(conflict);
          }
        }
      }
    }
    if (changed) {
      this.persist();
    }
    this.verified.set(identity.mac, this.now());
    return changed;
  }

  /**
   * Asks an address what it is. A device found by its announcement is first
   * asked without the token: the token only goes to a machine that wants it.
   */
  async probe(address, { announced = false } = {}) {
    const status = { lastTry: this.now() };
    this.probes.set(address, status);
    try {
      let token = announced ? '' : this.config.token;
      let info;
      try {
        info = await this.client.info(address, token);
      } catch (err) {
        if (!(announced && err.kind === 'auth' && this.config.token)) {
          throw err;
        }
        token = this.config.token;
        info = await this.client.info(address, token);
      }
      const identity = parseInfo(info);
      if (!identity) {
        status.error = 'unknown';
        this.warnOnce(`unknown:${address}`, `${address} is not a supported myStrom device`);
        return { changed: false };
      }
      status.mac = identity.mac;
      const extra = {};
      if (identity.kind === 'switch') {
        const report = await this.client.report(address, token);
        extra.caps = mergeCaps(this.data.devices[identity.mac]?.caps, switchCaps(report));
      }
      return { changed: this.remember(identity, address, extra), identity };
    } catch (err) {
      status.error = err.kind ?? 'error';
      this.logger.debug(`${address}: ${err.message}`);
      return { changed: false, error: err };
    }
  }

  /**
   * Checks that the device answering at a known address is still this one
   * (a DHCP lease may give the address to another device). False when it is
   * not: the device waits to be found again.
   */
  async verify(record) {
    const identity = parseInfo(await this.client.info(record.address, this.config.token));
    if (identity?.mac === record.mac) {
      this.verified.set(record.mac, this.now());
      return true;
    }
    const address = record.address;
    this.logger.warn(
      `${address} no longer answers as ${record.model} ${record.mac}` +
        (identity ? ` but as ${identity.model} ${identity.mac}` : '') +
        ': searching it again',
    );
    if (identity) {
      // remember() frees the address and starts the search.
      this.remember(identity, address);
    } else {
      record.address = '';
      this.setReachable(record, false, 'moved');
      this.requestSearch();
    }
    this.persist();
    return false;
  }

  needsVerify(record) {
    const last = this.verified.get(record.mac);
    return (
      last === undefined ||
      this.reachable.get(record.mac) === false ||
      this.now() - last >= TIMINGS.verifyInterval
    );
  }

  /** A search of the announcements, at most once a minute, for a device that moved. */
  requestSearch() {
    if (this.discovering || this.now() - this.lastSearch < TIMINGS.probeRetry) {
      return;
    }
    this.discover()
      .then(() => this.updateStatus())
      .catch((err) => this.logger.debug(`Search failed: ${err.message}`));
  }

  /** One polling round: the new addresses, then every known device. */
  poll() {
    if (!this.polling) {
      this.polling = this.doPoll().finally(() => {
        this.polling = undefined;
      });
    }
    return this.polling;
  }

  async doPoll() {
    let changed = false;
    const known = new Set(this.records.map((record) => record.address));
    const due = this.config.addresses.filter((address) => {
      const status = this.probes.get(address);
      return (
        !known.has(address) &&
        (!status || status.mac || this.now() - status.lastTry >= TIMINGS.probeRetry)
      );
    });
    for (const result of await Promise.all(due.map((address) => this.probe(address)))) {
      changed ||= result.changed;
    }
    const polled = this.records.filter((record) => record.kind !== 'button' && record.address);
    const before = JSON.stringify(this.records.map((record) => [record.mac, record.address]));
    await Promise.all(polled.map((record) => this.read(record)));
    changed ||= before !== JSON.stringify(this.records.map((r) => [r.mac, r.address]));
    return changed;
  }

  /** Reads one device and records its values. */
  async read(record) {
    const { mac } = record;
    const token = this.config.token;
    try {
      if (this.needsVerify(record) && !(await this.verify(record))) {
        return;
      }
      const { address } = record;
      let reading;
      if (record.kind === 'switch') {
        const report = await this.client.report(address, token);
        const energy = nextEnergy(this.data.energy[mac], report);
        if (energy) {
          this.data.energy[mac] = energy.counter;
          this.persist();
        }
        reading = { report, energyKwh: energy?.kwh };
      } else if (record.kind === 'bulb' || record.kind === 'strip') {
        const light = parseLightState(await this.client.deviceState(address, mac, token));
        this.lights.set(mac, light);
        reading = { light };
      } else if (record.kind === 'pir') {
        reading = { sensors: await this.client.pirSensors(address, token) };
      } else {
        return;
      }
      this.recordValues(record, readValues(record, reading));
      this.setReachable(record, true);
    } catch (err) {
      if (err.kind === 'auth') {
        this.warnOnce(`auth:${mac}`, `${record.model} ${mac} (${record.address}): ${err.message}`);
      }
      this.logger.debug(`${record.model} ${mac} (${record.address}): ${err.message}`);
      this.setReachable(record, false, err.kind);
    }
  }

  recordValues(record, values) {
    const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.mac);
    for (const [key, value] of values) {
      const featureId = ids.feature(key);
      const entry = { state: value };
      this.lastValues.set(featureId, entry);
      if (this.created.has(featureId)) {
        this.publisher.push(featureId, entry);
      }
    }
  }

  setReachable(record, reachable, error) {
    const previous = this.reachable.get(record.mac);
    this.reachable.set(record.mac, reachable);
    record.error = reachable ? undefined : error;
    if (previous !== reachable) {
      this.publishTransport(this.gladys.externalIds(EXTERNAL_ID_TYPE, record.mac).device).catch(
        (err) => this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
  }

  // --- Gladys devices ----------------------------------------------------------

  async publishDevices() {
    const devices = [];
    const measures = new Set();
    const events = new Set();
    this.features.clear();
    for (const record of this.records) {
      const device = buildDevice(this.gladys, record);
      devices.push(device);
      const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.mac);
      for (const key of featureKeys(record)) {
        const featureId = ids.feature(key);
        const spec = specOf(key, record.kind);
        this.features.set(featureId, { mac: record.mac, key });
        if (spec.measure) {
          measures.add(featureId);
        }
        if (spec.event) {
          events.add(featureId);
        }
      }
    }
    this.publisher.configure({ throttled: measures, events });
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the discovered devices failed: ${err.message}`));
  }

  /** Discovery "scan": the announcements, the addresses, then the device list. */
  async scan() {
    await this.discover().catch((err) => this.logger.warn(`Search failed: ${err.message}`));
    await this.poll();
    await this.publishDevices();
    this.updateStatus();
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const feature of device?.features ?? []) {
      const value = this.lastValues.get(feature.external_id);
      if (value) {
        this.publisher.push(feature.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  recordOf(deviceId) {
    return this.records.find(
      (record) => this.gladys.externalIds(EXTERNAL_ID_TYPE, record.mac).device === deviceId,
    );
  }

  transportOf(record) {
    return this.reachable.get(record.mac) === false
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransport(deviceId) {
    const record = this.recordOf(deviceId);
    // A button sleeps between presses: it has no reachability to show.
    if (!record || record.kind === 'button' || !this.reachable.has(record.mac)) {
      return;
    }
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const transport = this.transportOf(record);
    if (this.transports.get(deviceId) === transport) {
      return;
    }
    this.transports.set(deviceId, transport);
    await this.gladys.publishTransports([{ external_id: deviceId, transport }]);
  }

  async publishAllTransports() {
    const created = this.createdDevices();
    const entries = [];
    for (const record of this.records) {
      const deviceId = this.gladys.externalIds(EXTERNAL_ID_TYPE, record.mac).device;
      if (record.kind === 'button' || !this.reachable.has(record.mac) || !created.has(deviceId)) {
        continue;
      }
      const transport = this.transportOf(record);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  updateStatus() {
    const records = this.records;
    const polled = records.filter((record) => record.kind !== 'button');
    const buttons = records.length - polled.length;
    const answering = polled.filter((record) => this.reachable.get(record.mac)).length;
    const parts = [];
    let connected;
    if (records.length === 0) {
      connected = false;
      parts.push(T.noDevice);
    } else if (polled.length === 0) {
      connected = true;
      parts.push(T.onlyButtons(buttons));
    } else {
      connected = answering > 0;
      parts.push(T.status(answering, polled.length, buttons));
    }
    if (this.config.invalidAddresses.length > 0) {
      parts.push(T.invalidAddresses(this.config.invalidAddresses));
    }
    const refused = [
      ...[...this.probes].filter(([, s]) => s.error === 'auth').map(([address]) => address),
      ...polled.filter((record) => record.error === 'auth').map((record) => record.address),
    ];
    if (refused.length > 0) {
      parts.push(T.tokenRefused([...new Set(refused)]));
    }
    const unknown = [...this.probes].filter(([, s]) => s.error === 'unknown').map(([a]) => a);
    if (unknown.length > 0) {
      parts.push(T.notMyStrom(unknown));
    }
    for (const [address, [previous, next]] of this.conflicts) {
      parts.push(T.sameAddress(address, previous, next));
    }
    const lost = polled.filter((record) => !record.address && !this.isConflicted(record.mac));
    if (lost.length > 0) {
      parts.push(T.lost(lost.map((record) => record.mac)));
    }
    const message = {
      en: parts.map((p) => p.en).join(' '),
      fr: parts.map((p) => p.fr).join(' '),
    };
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  isConflicted(mac) {
    return [...this.conflicts.values()].some(([previous]) => previous === mac);
  }

  // --- Commands --------------------------------------------------------------

  async setValue(device, feature, value) {
    let target = this.features.get(feature.external_id);
    if (!target) {
      await this.publishDevices();
      target = this.features.get(feature.external_id);
    }
    const record = target && this.data.devices[target.mac];
    if (!record || !specOf(target.key, record.kind)?.write) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`Invalid value ${value}`);
    }
    // Never command another device that took over the address.
    if (!record.address || (this.needsVerify(record) && !(await this.verify(record)))) {
      throw new Error(`${record.model} ${record.mac} is not at its address any more`);
    }
    if (record.kind === 'switch') {
      await this.client.setRelay(record.address, number > 0, this.config.token);
      await this.read(record);
      return;
    }
    await this.commandLight(record, target.key, number);
  }

  async commandLight(record, key, value) {
    const { address, mac } = record;
    const token = this.config.token;
    const current =
      this.lights.get(mac) ?? parseLightState(await this.client.deviceState(address, mac, token));
    const brightness = current.brightness > 0 ? current.brightness : 100;
    let form;
    if (key === 'light' || (key === 'brightness' && value <= 0)) {
      form = { action: value > 0 ? 'on' : 'off' };
    } else if (key === 'brightness') {
      form = {
        action: 'on',
        color:
          current.mode === 'mono'
            ? monoColor(current.mireds ?? 262, value)
            : hsvColor(current.hue ?? 0, current.saturation ?? 0, value),
      };
    } else if (key === 'color') {
      const hsv = rgbToHsv(Math.round(value) & 0xffffff);
      form = { action: 'on', color: hsvColor(hsv.h, hsv.s, brightness) };
    } else if (key === 'white' && record.kind === 'bulb') {
      form = { action: 'on', color: monoColor(value, brightness) };
    } else {
      throw new Error(`${key} cannot be set on a ${record.model}`);
    }
    const answer = await this.client.setDevice(address, mac, form, token);
    const light = parseLightState(answer ?? (await this.client.deviceState(address, mac, token)));
    this.lights.set(mac, light);
    this.recordValues(record, readValues(record, { light }));
    this.setReachable(record, true);
  }

  // --- Buttons -----------------------------------------------------------------

  /**
   * The receiver runs once a button is known (it costs nothing to the others);
   * the channel opens only once Gladys says the receiver is running.
   */
  async startReceiver() {
    if (this.channel || !this.records.some((record) => record.kind === 'button')) {
      return;
    }
    this.lastReceiverTry = this.now();
    try {
      if ((await this.ensureReceiver())?.status === 'running') {
        this.startChannel();
      }
    } catch {
      // Logged; tried again at a later polling round.
    }
  }

  receiverEnv() {
    return {
      BUTTON_TOKEN: this.data.tokens.button,
      CHANNEL_TOKEN: this.data.tokens.channel,
      HTTP_PORT: String(RECEIVER.httpPort),
      CHANNEL_PORT: String(RECEIVER.channelPort),
      ...(this.logLevel ? { LOG_LEVEL: this.logLevel } : {}),
    };
  }

  async receiverContainer() {
    const containers = await this.gladys.getContainers();
    return containers.find((container) => container.name === RECEIVER.name);
  }

  /**
   * Starts (or recreates) the receiver when it is not running with the
   * current environment; resolves the container as Gladys then shows it.
   */
  async ensureReceiver() {
    const env = this.receiverEnv();
    const envHash = hash(env);
    try {
      const current = await this.receiverContainer();
      if (current?.status === 'running' && this.data.receiverEnvHash === envHash) {
        return current;
      }
      await this.gladys.startContainer(RECEIVER.name, { env });
      this.data.receiverEnvHash = envHash;
      this.persist();
      this.logger.info('Button receiver started');
      return await this.receiverContainer();
    } catch (err) {
      this.logger.error('Could not start the button receiver container', err);
      throw err;
    }
  }

  startChannel() {
    if (this.channel) {
      return;
    }
    this.channel = this.createChannel({
      host: RECEIVER.name,
      port: RECEIVER.channelPort,
      token: this.data.tokens.channel,
      logger: this.logger,
    });
    this.channel.on('up', () => this.logger.info('Connected to the button receiver'));
    this.channel.on('down', () => this.logger.warn('Lost the button receiver, reconnecting'));
    this.channel.on('message', (message) => {
      if (message?.type === 'press') {
        this.onPress(message);
      }
    });
    this.channel.start();
  }

  /** A press relayed by the receiver: the button feature and the scene trigger. */
  onPress({ mac, press, at }) {
    const record = this.data.devices[mac];
    if (!record || record.kind !== 'button' || !(press in PRESS_VALUES)) {
      this.warnOnce(`press:${mac}`, `A press from an unknown button ${mac} was ignored`);
      return;
    }
    const time = this.now();
    const age = time - Date.parse(at);
    if (Number.isFinite(age) && age > STALE_PRESS) {
      this.logger.info(`A ${press} press of ${mac} kept by the receiver is too old: ignored`);
      return;
    }
    const ids = this.gladys.externalIds(EXTERNAL_ID_TYPE, mac);
    const featureId = ids.feature('button');
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, { state: PRESS_VALUES[press] });
    }
    this.eventWindow = this.eventWindow.filter((t) => time - t < 60_000);
    if (this.eventWindow.length >= LIMITS.eventsPerMinute) {
      this.warnOnce('events', 'Too many button presses in a minute: the next ones are dropped');
      return;
    }
    this.eventWindow.push(time);
    this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.BUTTON, { device: ids.device, press })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  // --- Configuration screen buttons ------------------------------------------

  /** The UDP announcements captured by the core, one search at a time. */
  discover() {
    if (!this.discovering) {
      this.lastSearch = this.now();
      this.discovering = this.doDiscover().finally(() => {
        this.discovering = undefined;
      });
    }
    return this.discovering;
  }

  async doDiscover() {
    const results = await this.gladys.scanNetwork('udp-broadcast', {
      timeoutSeconds: TIMINGS.scanSeconds,
    });
    const announced = parseAnnouncements(results);
    const answers = await mapLimit(announced, TIMINGS.probeConcurrency, async (device) => {
      const address = urlHost(device.ip);
      const result = await this.probe(address, { announced: true });
      return { device, address, ...result };
    });
    const found = [];
    let changed = false;
    for (const { device, address, identity: probed, changed: updated } of answers) {
      let identity = probed;
      let moved = updated;
      if (!identity && device.kind === 'button') {
        // Asleep again already: the announcement says enough to wait for its presses.
        identity = { ...device, firmware: '', name: '' };
        moved = this.remember(identity, address);
      }
      changed ||= Boolean(moved);
      if (identity) {
        found.push({ ...identity, address });
      }
    }
    if (changed) {
      await this.publishDevices();
      await this.startReceiver();
    }
    return found;
  }

  async findDevices() {
    let found;
    try {
      found = await this.discover();
    } catch (err) {
      return T.find.failed(err.message);
    }
    this.updateStatus();
    if (found.length === 0) {
      return T.find.none;
    }
    return T.find.found(
      found.map((device) => {
        const label = KIND_LABELS[device.kind];
        return {
          en: `${label.en} ${device.model} ${device.mac} (${device.address})`,
          fr: `${label.fr} ${device.model} ${device.mac} (${device.address})`,
        };
      }),
    );
  }

  /** Writes the action URLs of every known button that is awake. */
  async setupButtons() {
    if (this.config.gladysHostError) {
      return T.setup.badGladysAddress;
    }
    if (!this.config.gladysHost) {
      return T.setup.noGladysAddress;
    }
    const buttons = this.records.filter((record) => record.kind === 'button' && record.address);
    if (buttons.length === 0) {
      return T.setup.noButton;
    }
    let port;
    try {
      const container = await this.ensureReceiver();
      if (container?.status !== 'running') {
        return T.setup.noPort(container?.status ?? 'not started');
      }
      this.startChannel();
      port = container.ports?.find((p) => p.name === RECEIVER.httpPortName)?.host_port;
    } catch (err) {
      return T.setup.noPort(err.message);
    }
    if (!port) {
      return T.setup.noPort('no host port yet');
    }
    const base = `get://${urlHost(this.config.gladysHost, port)}/press/${this.data.tokens.button}`;
    const done = [];
    const failed = [];
    for (const record of buttons) {
      const form = {
        single: `${base}/${record.mac}/single`,
        double: `${base}/${record.mac}/double`,
        long: `${base}/${record.mac}/long`,
        ...(record.touch ? { touch: `${base}/${record.mac}/touch` } : {}),
      };
      const label = `${record.name || record.model} ${record.mac}`;
      try {
        await this.client.setDevice(record.address, record.mac, form, this.config.token);
        done.push(label);
      } catch (err) {
        this.logger.info(`Button ${record.mac} (${record.address}): ${err.message}`);
        failed.push(label);
      }
    }
    return T.setup.result(done, failed);
  }
}
