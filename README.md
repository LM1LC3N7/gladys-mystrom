# gladys-mystrom

[Gladys Assistant](https://gladysassistant.com) external integration for
**myStrom** Wi-Fi devices, on the local network: switches (on/off, power,
energy, temperature), bulbs and LED strips (on/off, brightness, colour, white),
buttons and Button Plus (presses as a scene trigger) and motion sensors become
Gladys devices of the Discovery tab, through the official local REST API of the
devices, without the myStrom cloud. Unofficial, not affiliated with myStrom AG.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against sample answers only,
> not yet against real myStrom devices.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (MyStromApp)
                                   ├─ src/mystrom/client.js   HTTP :80 to each device (fetch, form bodies, Token header)
                                   ├─ src/mystrom/info.js     /api/v1/info and UDP 7979 announcements -> identity (pure)
                                   ├─ src/mystrom/light.js    hsv / mono / rgb colours <-> Gladys (pure)
                                   ├─ src/model.js            known devices -> Gladys devices and values (pure)
                                   ├─ src/energy.js           energy_since_boot + boot_id -> growing kWh index (pure)
                                   ├─ src/publisher.js        states within 250/min (Gladys: 300), measures spaced
                                   ├─ src/store.js            /data/mystrom.json: known devices, energy, tokens
                                   └─ src/channel.js ⇄ mystrom-buttons sub-container (src/receiver.js)
                                                         └─ src/buttons/service.js  HTTP :8080, published by Gladys
```

- **Devices** are added by IP address (configuration), or found with
  `gladys.scanNetwork('udp-broadcast')`: the devices announce themselves on UDP
  7979 (MAC, type, flags), which the integration container cannot hear on its
  bridge network. Each one is identified with `GET /api/v1/info` (`/info.json`
  on old firmware) and kept in `/data` by MAC, so a sleeping button or a new IP
  address changes nothing. External ids: `mystrom:<MAC>`. A machine that
  announces itself is first asked without the API token; the token is only
  sent if it answers that it wants one.
- **The MAC is checked again** (`/api/v1/info`) when a device comes back
  online, every 10 minutes, and before a command when the last check is
  older: a DHCP lease that gave the address to another device marks the old
  one unreachable and starts a new search; the status names both devices.
- **Polling** every `poll_interval` seconds: `GET /report` (Switch),
  `GET /api/v1/device/<MAC>` (Bulb, LED Strip; only the entry of that MAC is
  read), `GET /api/v1/sensors` (Motion Sensor). A secured device answers 404
  without its token: read as "token missing or refused". Commands:
  `GET /relay?state=0|1`, `POST /api/v1/device/<MAC>` with a form body whose
  `;`, `:` and `/` stay in clear (`action=on&color=120;100;50`), as the
  firmware reads it.
- **Buttons** call their action URLs when pressed. The main container cannot
  publish a port, so a sub-container of the same image (`node
src/receiver.js`) serves `GET /press/<secret>/<MAC>/<press>` on a port Gladys
  publishes, and hands each press to the main container over a private TCP
  channel (the pattern of LM1LC3N7/gladys-ajax), authenticated both ways by
  an HMAC challenge-response with a nonce on each side (the channel secret
  never goes on the wire). The main container opens it only once Gladys shows
  the receiver running. The "Set the button action URLs" button writes these
  URLs into every awake button.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/mystrom.js` holds device answers shaped like the documented
ones and a fake `fetch`; the end-to-end tests run the real handlers against the
SDK's fake Gladys.

## Credits

- [`python-mystrom`](https://github.com/home-assistant-ecosystem/python-mystrom)
  by Fabian Affolter (MIT), the library behind the Home Assistant myStrom
  integration: the endpoints, the device type codes, the UDP announcement
  format and the bulb colour formats are taken from it (ported to JavaScript,
  no code copied).
- The official [myStrom REST API documentation](https://api.mystrom.ch) and
  the [button API notes](https://mystrom.ch/wp-content/uploads/REST_API_WBP.txt).
- `src/publisher.js` comes from
  [LM1LC3N7/gladys-ikea](https://github.com/LM1LC3N7/gladys-ikea) and
  `src/channel.js` from
  [LM1LC3N7/gladys-ajax](https://github.com/LM1LC3N7/gladys-ajax) (same author,
  Apache-2.0).

myStrom is a trademark of myStrom AG, used here only to name the compatible
products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest (the sub-container follows),
rolls `CHANGELOG.md`, tags, builds the multi-arch image to GHCR and publishes
the GitHub Release. The `gladys-assistant-integration` topic is added at the
first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (python-mystrom, MIT):
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
