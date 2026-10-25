# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.4] - 2026-10-25

### Fixed

- The "Address of Gladys for the buttons" field never reached the integration
  (Gladys keeps the `GLADYS_*` config keys for itself): it is stored under a
  new key, and an address already typed with 0.1.3 is copied into the new
  field automatically at the first start after the update.

## [0.1.3] - 2026-10-23

## [0.1.2] - 2026-10-17

### Changed

- LICENSE: standard Apache-2.0 appendix line, without a personal name.

## [0.1.1] - 2026-10-16

### Added

- myStrom devices over their local REST API, without the cloud: added by IP
  address, or found on the network from their UDP announcements (through
  Gladys), and kept by MAC address when their address changes.
- Switches: on/off, power, energy index (kept growing across restarts) and
  temperature, as far as the model measures them.
- Bulbs and LED strips: on/off, brightness, colour, and the white temperature
  of the bulb.
- Motion sensors: motion, light level and temperature.
- Buttons and Button Plus: a button feature and the "myStrom button" scene
  trigger (single, double, long press, touch), through a receiver
  sub-container whose action URLs the "Set the button action URLs" button
  writes into the buttons.
- An optional API token for devices secured in the myStrom app, sent to a
  device found by the search only if it asks for it.
- The device answering at an address is checked to still be the same one: a
  device whose address went to another one is shown unreachable, searched
  again, and named in the status.
- Reachability on the transport badge, states within the Gladys rate limit,
  measurements spaced by a minute, the switches, lights, motion and presses
  first.

[Unreleased]: https://github.com/LM1LC3N7/gladys-mystrom/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/LM1LC3N7/gladys-mystrom/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/LM1LC3N7/gladys-mystrom/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-mystrom/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-mystrom/releases/tag/v0.1.1
