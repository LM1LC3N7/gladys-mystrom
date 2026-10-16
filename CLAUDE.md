# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for myStrom Wi-Fi devices (local
REST API, no cloud): a Node.js service (Node 22+, ESM, no build step) that runs
in its own sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
The same image also runs the `mystrom-buttons` sub-container (button action
URLs). See `TODO.md` for the status and the decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "bulb"    # tests whose name matches
npm run cover                             # regenerate cover.png (800×534)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/handlers.js registered before connect()
src/handlers.js                   the SDK handlers -> MyStromApp (shared with the tests)
src/app.js                        MyStromApp: known devices, polling, commands, buttons, actions
src/mystrom/client.js             HTTP client of the device API (form bodies, Token header)
src/mystrom/info.js               /api/v1/info and UDP 7979 announcements -> identity (pure)
src/mystrom/light.js              hsv / mono / rgb colours <-> Gladys (pure)
src/model.js                      known devices -> Gladys devices and values (pure)
src/energy.js                     growing kWh index across switch restarts (pure)
src/publisher.js                  states within the rate limit (250/min), measures spaced
src/store.js                      /data/mystrom.json (known devices, energy, secrets)
src/channel.js                    private TCP channel, mutual HMAC challenge-response
src/receiver.js, src/buttons/     the mystrom-buttons sub-container (HTTP press URLs)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js, src/i18n.js     frozen keys, limits, timings; texts in English and French
scripts/cover.mjs                 cover.png generator (plain Node)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake fetch
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only, for the receiver).
- **Encoding.** Every file is UTF-8 without BOM; `test/encoding.test.js`
  refuses mojibake (UTF-8 text read as Latin-1 and saved again) in the
  manifest, the docs and these files.
- **Devices.** Never trust an address alone: the MAC answering there is
  checked again (`/api/v1/info`) when the last check is old — the device came
  back online, 10 minutes passed, or a command finds it older than that — and
  a device state is only read from the entry of its own MAC.
