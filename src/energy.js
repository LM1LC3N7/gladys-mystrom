// -----------------------------------------------------------------------------
// The energy index of a Switch (pure).
//
// A Switch counts `energy_since_boot` (watt-seconds) from its last start, and
// says which start with `boot_id` (and how long ago with `time_since_boot`).
// Gladys wants an index that only grows: the energy of the previous starts is
// kept (`baseWs`, saved in /data) and added.
// -----------------------------------------------------------------------------

/** The start identifier of a report (a string or a number), undefined when absent. */
export function bootIdOf(report) {
  const id = report?.boot_id;
  if (typeof id === 'string' && id.trim() !== '') {
    return id.trim();
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id);
  }
  return undefined;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * @param {{ bootId: string, baseWs: number, lastWs: number, lastUptime?: number } | undefined} previous
 * @param {object} report the /report answer
 * @returns {{ counter: object, kwh: number } | undefined}
 */
export function nextEnergy(previous, report) {
  const sinceBoot = report?.energy_since_boot;
  const bootId = bootIdOf(report);
  if (!finite(sinceBoot) || sinceBoot < 0 || bootId === undefined) {
    return undefined;
  }
  const uptime = finite(report.time_since_boot) ? report.time_since_boot : undefined;
  let baseWs = previous?.baseWs ?? 0;
  let lastWs = sinceBoot;
  // A restart is a new boot_id, or an uptime going back: nothing else.
  const restarted =
    previous !== undefined &&
    (previous.bootId !== bootId ||
      (uptime !== undefined && finite(previous.lastUptime) && uptime < previous.lastUptime));
  if (restarted) {
    baseWs += previous.lastWs;
  } else if (previous && sinceBoot < previous.lastWs) {
    // Same start, a lower counter: a glitch, the index never goes back.
    lastWs = previous.lastWs;
  }
  const counter = { bootId, baseWs, lastWs };
  if (uptime !== undefined) {
    counter.lastUptime = uptime;
  }
  return { counter, kwh: (baseWs + lastWs) / 3_600_000 };
}
