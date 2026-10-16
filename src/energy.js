// -----------------------------------------------------------------------------
// The energy index of a Switch (pure).
//
// A Switch counts `energy_since_boot` (watt-seconds) from its last start, and
// says which start with `boot_id`. Gladys wants an index that only grows: the
// energy of the previous starts is kept (`baseWs`, saved in /data) and added.
// -----------------------------------------------------------------------------

/**
 * @param {{ bootId: string, baseWs: number, lastWs: number } | undefined} previous
 * @param {object} report the /report answer
 * @returns {{ counter: { bootId, baseWs, lastWs }, kwh: number } | undefined}
 */
export function nextEnergy(previous, report) {
  const sinceBoot = report?.energy_since_boot;
  const bootId = typeof report?.boot_id === 'string' ? report.boot_id : '';
  if (typeof sinceBoot !== 'number' || !Number.isFinite(sinceBoot) || sinceBoot < 0 || !bootId) {
    return undefined;
  }
  let baseWs = previous?.baseWs ?? 0;
  if (previous && (previous.bootId !== bootId || sinceBoot < previous.lastWs)) {
    // A restart (or a counter reset): what the previous start counted is kept.
    baseWs += previous.lastWs;
  }
  const counter = { bootId, baseWs, lastWs: sinceBoot };
  return { counter, kwh: (baseWs + sinceBoot) / 3_600_000 };
}
