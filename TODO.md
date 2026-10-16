# TODO — myStrom v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm audit --omit=dev`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local API** (2026-10-16): addresses typed or found from
      the UDP announcements (`scanNetwork`), identity by `/api/v1/info`,
      registry kept in `/data` by MAC, Switch / Bulb / LED Strip / Motion
      Sensor polling and commands, energy index across restarts, buttons
      through the `mystrom-buttons` receiver sub-container and its action URLs,
      `button_pressed` scene trigger, transport badges, states within the rate
      limit, two buttons, manifest, docs en/fr. Tested against sample answers
      and fakes only.
- [ ] **Milestone 2 — real hardware** (testers with the devices): record real
      answers as fixtures, fix what differs. To check first:
  - the mono white scale (1 = warm 2700 K, 18 = cold 6500 K assumed) and
    whether a bulb in `rgb` mode answers `WWRRGGBB`;
  - the answer of `POST /api/v1/device/<MAC>` (the new state, or empty?);
  - `light` of `/api/v1/sensors` really in lux, and which temperature it is
    (measured or compensated);
  - the `type` of `/api/v1/info` on every model (number or code) and the Switch
    Zero report (no power meter?);
  - the Button Plus 2nd gen: does it keep the `single/double/long/touch`
    action URLs of the 1st gen, and its temperature/humidity sensors;
  - the receiver reached from the LAN on the published host port, the private
    network alias `mystrom-buttons`, on a real Gladys 5.1+;
  - a secured device: which status code a missing or wrong token gets (401?
    404?).
- [ ] **Milestone 3 — more**: one token per device, a "forget a device"
      action, the Button Plus wheel (`wheel`, `wheel_final`), the Button Plus
      2nd gen sensors and battery voltage, the motion sensor's own action URLs
      (instant motion instead of polling), bulb ramp (transition time).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published
      (at milestone 1 its only errors are the two `docker_image` not yet
      pullable from GHCR: main image and the `mystrom-buttons` sub-container).

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: python-mystrom (MIT) is Python, so its endpoints, type codes and
  announcement format are ported, not imported; no runtime dependency besides
  the SDK (`fetch` is built in).
- External ids: `gladys.externalIds('mystrom', MAC)` whatever the model, so a
  model misread never changes the id. Feature keys are frozen: `switch`,
  `power`, `energy`, `temperature`, `light`, `brightness`, `color`, `white`,
  `light-power`, `motion`, `light-level`, `button`.
- The features of a Switch are fixed by its first report (power, temperature,
  energy counter present or not).
- Discovery: the UDP announcements through `gladys.scanNetwork('udp-broadcast')`
  on port 7979 (the container is on a bridge network); the typed addresses are
  probed again every minute until they answer. Known devices stay known (a
  button sleeps); a device answering at a new address moves.
- Buttons: the main container cannot publish a port, so the receiver is a
  sub-container of the same image (as gladys-ajax) on container port 8080,
  started only once a button is known, restarted only when its environment
  changes. The URL carries a 32-character random secret and the MAC; the
  channel to the main container has its own secret; both are kept in `/data`,
  never logged. Presses older than one minute (kept while the main container
  was away) fire no scene. Unknown MACs are ignored.
- Button values: single = CLICK (1), double = DOUBLE_CLICK (2), long =
  LONG_CLICK (6), touch = PRESSED (60) (Gladys `BUTTON_STATUS`, no "touch").
- The integration never writes the action URLs by itself: only the "Set the
  button action URLs" button does (it replaces the URLs set by the app).
- Lights: brightness 0 turns off; a colour command keeps the brightness; a
  brightness command keeps the hue (hsv) or the white (mono); white in mireds
  154–370 mapped onto the mono scale 1–18.
- Measurements (power, energy, temperature, light level) are spaced by 60 s per
  feature; relays, lights, motion and presses are not delayed; a repeated press
  is sent again.
- Polling 5 s to 300 s (default 10 s): the motion sensor is polled, its action
  URLs are left untouched.
