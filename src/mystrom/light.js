// -----------------------------------------------------------------------------
// The colours of the myStrom Bulb and LED Strip (pure).
//
// Their state carries `on`, `mode` and `color`, whose format follows the mode:
//   hsv   "<hue 0-360>;<saturation 0-100>;<value 0-100>"
//   mono  "<white temperature 1-18>;<brightness 0-100>"      (Bulb only)
//   rgb   "WWRRGGBB" (hex, white channel first)
// A command sends `color` in the same formats: the device picks the mode from
// it. Gladys wants the colour as an RGB integer, the brightness in % and the
// white temperature in mireds.
// -----------------------------------------------------------------------------

/** The mono scale: 1 is the warmest white (2700 K), 18 the coldest (6500 K). */
export const MONO = { min: 1, max: 18, warmMireds: 370, coldMireds: 154 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function hsvToRgb(h, s, v) {
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = val - c;
  const byte = (channel) => Math.round((channel + m) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

export function rgbToHsv(rgb) {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) {
      h += 360;
    }
  }
  return {
    h: h % 360,
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

export function monoToMireds(t) {
  const step = (clamp(t, MONO.min, MONO.max) - MONO.min) / (MONO.max - MONO.min);
  return Math.round(MONO.warmMireds - step * (MONO.warmMireds - MONO.coldMireds));
}

export function miredsToMono(mireds) {
  const step =
    (MONO.warmMireds - clamp(mireds, MONO.coldMireds, MONO.warmMireds)) /
    (MONO.warmMireds - MONO.coldMireds);
  return Math.round(MONO.min + step * (MONO.max - MONO.min));
}

const numbers = (text) =>
  String(text ?? '')
    .split(';')
    .map((part) => Number(part));

/**
 * The state of a light as Gladys sees it.
 * @returns {{ on: boolean, mode: string, brightness?: number, color?: number, mireds?: number,
 *   hue?: number, saturation?: number, power?: number }}
 */
export function parseLightState(state) {
  const result = { on: Boolean(state?.on), mode: String(state?.mode ?? '') };
  const color = String(state?.color ?? '');
  const parts = numbers(color);
  const finite = parts.every(Number.isFinite);
  if (result.mode === 'mono' || (parts.length === 2 && finite)) {
    if (parts.length === 2 && finite) {
      result.mode = 'mono';
      result.mireds = monoToMireds(parts[0]);
      result.brightness = clamp(Math.round(parts[1]), 0, 100);
    }
  } else if (parts.length === 3 && finite) {
    result.mode = 'hsv';
    result.hue = clamp(Math.round(parts[0]), 0, 360);
    result.saturation = clamp(Math.round(parts[1]), 0, 100);
    result.brightness = clamp(Math.round(parts[2]), 0, 100);
    result.color = hsvToRgb(result.hue, result.saturation, 100);
  } else if (/^(?:[0-9a-f]{2})?[0-9a-f]{6}$/i.test(color)) {
    result.mode = 'rgb';
    const hex = color.slice(-6);
    const white = color.length === 8 ? parseInt(color.slice(0, 2), 16) : 0;
    const rgb = parseInt(hex, 16);
    const hsv = rgbToHsv(rgb);
    result.hue = hsv.h;
    result.saturation = hsv.s;
    result.brightness = Math.round((Math.max(hsv.v / 100, white / 255) || 0) * 100);
    result.color = rgb === 0 && white > 0 ? 0xffffff : hsvToRgb(hsv.h, hsv.s, 100);
  }
  if (typeof state?.power === 'number' && Number.isFinite(state.power)) {
    result.power = Math.round(state.power * 10) / 10;
  }
  return result;
}

/** The `color` of an HSV command. */
export const hsvColor = (h, s, v) =>
  `${Math.round(clamp(h, 0, 360))};${Math.round(clamp(s, 0, 100))};${Math.round(clamp(v, 0, 100))}`;

/** The `color` of a mono (white) command. */
export const monoColor = (mireds, brightness) =>
  `${miredsToMono(mireds)};${Math.round(clamp(brightness, 0, 100))}`;
