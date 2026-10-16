# myStrom

Your myStrom Wi-Fi devices in Gladys, on your local network, through the REST
API the devices serve themselves: no myStrom cloud, no account. Unofficial
integration, not affiliated with myStrom AG.

## What you get

| Device                                | In Gladys                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Switch (CH v1, CH v2, EU, Zero)       | On/off, power (W), energy index (kWh), temperature (°C), as far as the model measures them |
| Bulb                                  | On/off, brightness, colour, white temperature, power                                       |
| LED Strip                             | On/off, brightness, colour, power                                                          |
| Button, Button Plus (1st and 2nd gen) | A button feature, and the **myStrom button** scene trigger (single, double, long, touch)   |
| Motion Sensor (PIR)                   | Motion, light level (lux), temperature                                                     |

The switches, lights and motion sensors are read every 10 seconds (the
**Refresh interval** setting, 5 seconds to 5 minutes): a motion is seen at most
that late. The energy index keeps growing when a switch restarts.

## Setup

1. In your router, give every myStrom device a fixed IP address (a DHCP
   reservation): the integration reaches them by address.
2. In Gladys, open the integration **Configuration** tab and type the
   addresses in **IP addresses of the devices**, separated by commas, for
   example `192.168.1.30, 192.168.1.31`. Or press **Find the myStrom
   devices**: the devices announce themselves on the network every few
   seconds, and Gladys listens for 7 seconds.
3. Save. The devices appear in the **Discovery** tab: add the ones you want.

If you secured the local API of your devices with a token in the myStrom app,
type it in **API token**. One token for all the devices: devices secured with
different tokens are not supported yet. A device found by the search is first
asked without the token: the token is only sent to a device that asks for it.

The integration checks regularly that the device answering at an address is
still the same one (its MAC address). If your router gives the address of a
device to another one, the first is shown unreachable and searched again, and
the status of the integration names both: give your devices fixed addresses.

## Buttons

A myStrom button sleeps between presses: Gladys cannot ask it anything. When
pressed, it calls the address it was given (its "action URL"). The integration
runs a small receiver for these calls, in a second container that Gladys starts
and publishes on a port of the Gladys machine (shown in the configuration
screen).

1. Type the IP address of the Gladys machine on your network in **Address of
   Gladys for the buttons** (for example `192.168.1.10`), and save.
2. Plug each button on USB: it stays awake while charging. Make it known to
   Gladys (its address in the list, or **Find the myStrom devices**).
3. Press **Set the button action URLs**. The single, double and long presses
   (and the touch of a Button Plus) of every awake button now call Gladys. This
   replaces what the myStrom app had set on these presses.
4. In a scene, use the **myStrom button** trigger, pick the button and the
   press. The press is in the `press` variable of the trigger.

A button not reached (asleep) is named in the answer: plug it on USB and press
the configuration button again.

The action URLs contain a random secret, so another machine of your network
cannot fire your scenes by guessing them. It is a limited protection: the
buttons call Gladys in plain HTTP, so the secret can be seen by anyone
listening on your network, and read back from a button by anyone who can reach
its local API. It only starts scenes, it gives no access to Gladys. If you
think it leaked, see "Troubleshooting".

## Good to know

- Everything stays on your network: Gladys talks to the devices in plain HTTP,
  as the myStrom API does. Keep your Wi-Fi closed to strangers.
- The Button Plus wheel, the Bulb effects (sunrise, rainbow) and the motion
  sensor settings are not handled.
- The devices reached by Gladys show a "local" badge, an "unreachable" one when
  they stop answering.

## Troubleshooting

- **"Token refused"**: the device has a token in the myStrom app; type it in
  **API token**.
- **Nothing found by the search**: some networks do not let Gladys hear the
  announcements, and buttons only announce themselves while awake. Type the
  addresses instead.
- **The button secret leaked**: renewing it is not possible from the
  configuration screen yet (planned). Meanwhile, remove the action URLs of the
  button in the myStrom app.
- **A button press does nothing**: check that the Gladys address is the one
  the buttons reach (not a VPN or Gladys Plus address), and set the action URLs
  again after changing it.
