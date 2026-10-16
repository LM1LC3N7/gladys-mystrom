# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-mystrom/commits/main
