// -----------------------------------------------------------------------------
// What identifies a myStrom device (pure): its /api/v1/info answer and its UDP
// announcement.
//
// The devices broadcast 8 bytes on UDP port 7979 every few seconds: the MAC
// (6 bytes), the device type (1 byte) and status flags (1 byte: child, myStrom
// registered, online, restarted), as python-mystrom's discovery.py reads them.
// The integration container cannot hear broadcasts (bridge network): the
// Gladys core captures them for it (gladys.scanNetwork 'udp-broadcast').
// -----------------------------------------------------------------------------

import { DEVICE_TYPES } from '../constants.js';
import { normalizeMac } from './client.js';

const BY_CODE = new Map(
  Object.entries(DEVICE_TYPES).map(([id, entry]) => [entry.code, Number(id)]),
);

/** The device type entry of a numeric type or a type code ("WSE"), undefined when unknown. */
export function deviceType(type) {
  if (typeof type === 'number' || /^\d+$/.test(String(type ?? ''))) {
    const id = Number(type);
    return DEVICE_TYPES[id] ? { id, ...DEVICE_TYPES[id] } : undefined;
  }
  const id = BY_CODE.get(String(type ?? '').toUpperCase());
  return id ? { id, ...DEVICE_TYPES[id] } : undefined;
}

const str = (value) => (typeof value === 'string' ? value.trim().slice(0, 100) : '');

/**
 * The identity of a device from its info answer.
 * @returns {{ mac, typeId, kind, model, touch, firmware, name } | undefined} undefined
 *   when the answer has no MAC or an unknown type
 */
export function parseInfo(info) {
  const mac = normalizeMac(info?.mac);
  const type = deviceType(info?.type);
  if (!mac || !type) {
    return undefined;
  }
  return {
    mac,
    typeId: type.id,
    kind: type.kind,
    model: type.model,
    touch: Boolean(type.touch),
    firmware: str(info.version),
    name: str(info.name),
  };
}

/** One UDP announcement (`{ source_ip, payload_base64 }`), undefined when it is not one. */
export function parseAnnouncement(entry) {
  let bytes;
  try {
    bytes = Buffer.from(String(entry?.payload_base64 ?? ''), 'base64');
  } catch {
    return undefined;
  }
  const ip = str(entry?.source_ip);
  if (bytes.length !== 8 || !/^[0-9.]+$|:/.test(ip)) {
    return undefined;
  }
  const mac = bytes.subarray(0, 6).toString('hex').toUpperCase();
  const type = deviceType(bytes[6]);
  if (!type) {
    return undefined;
  }
  return {
    mac,
    ip,
    typeId: type.id,
    kind: type.kind,
    model: type.model,
    touch: Boolean(type.touch),
  };
}

/** The announcements of a scan, one per MAC (the last address wins). */
export function parseAnnouncements(entries) {
  const found = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const device = parseAnnouncement(entry);
    if (device) {
      found.set(device.mac, device);
    }
  }
  return [...found.values()];
}
