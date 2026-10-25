# Homey

Pinned Homey Pro devices, flows and webhooks inside Yuvomi.

The module is browser code. The Homey address and API key live in a separate sidecar service, not in Yuvomi and not in the browser. The service answers on `/api/extensions/homey`. Yuvomi does not run the module’s server files itself, so a reverse proxy must send that path here. On this machine `gateway.js` does that: it listens on the household port, answers Homey routes itself, and forwards everything else to Yuvomi.

## Connect

1. In Homey: Settings → API keys. The key needs device read and control. If flows should be pinned, it also needs flow read and start.
2. Run the app on a machine on the same network as Homey. The Cursor Cloud preview is a tunnel: the browser hits `127.0.0.1:3000`, while the process runs in the cloud and cannot reach `192.168.x.x`.

On the Raspberry Pi (default address `192.168.1.24`):

```bash
curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomi-Homey-NOR/cursor/weather-hourly-mobile-gutter-be88/modules/homey/install-pi.sh | sudo bash
```

The script clones this branch to `/opt/yuvomi`, installs Docker if needed, and starts Yuvomi plus the gateway. Run the same command again after an update. The gateway loads its code only when the container starts, so the script recreates it. Open `http://192.168.1.24:3000` from another device on the same network.

For local development on a PC on the same network:

```bash
npm run dev:homey
```

That starts Yuvomi on port 3001 and the gateway on port 3000.

3. Open Homey in the menu. Paste the address, for example `http://192.168.1.50`, and the key. Only an administrator can save it.
4. Pin a control (light, switch, flow, webhook) or show a sensor (temperature, humidity, power). Controls run on press; sensors only display the live value.
5. Use **Edit** on a pin to change its name and icon (thermometer, lightbulb, speaker, and so on).
6. Pinned tiles also appear in the **Homey** widget on Overview. The widget is on by default; hide it or change its size under Customize.

The key is written to `data/homey/state.json` with owner-only file permissions. No route returns it.

## Doorbell

On the Homey page an administrator creates a ring URL. It is shown only once. A Homey flow calls it with GET when the doorbell is pressed, for example when UniFi Protect reports that someone pressed the G6 Entry Pro:

`http://192.168.1.24:3000/api/extensions/homey/ring?token=…`

The tablet with Yuvomi open places a card over the whole screen, including the photo screensaver. The card dismisses itself after 30 seconds. Close, or Escape, dismisses it earlier.

Under the doorbell section pick a camera, or leave the list on automatic. That uses the doorbell device in Homey, for example UniFi G6 Entry Pro. “Test alert and picture” shows the card with that picture without ringing the doorbell or the chimes. The picture refreshes while the card is open. The same picture is shown when the Homey flow calls the ring URL.

The picture is fetched from Homey with the stored API key. If the device has an IP address, the camera’s own snapshot is tried first. Otherwise the picture UniFi Protect stored in Homey is used; that can be a few seconds old. RTSP cannot play in the browser. Another http or https URL can be pasted if Homey has no picture. The address, camera IP and API key are not sent to the browser, and the picture is fetched only while the card is open.

The URL is a secret. Anyone who has it can trigger the card. Wall mode does not load modules itself. The gateway therefore serves the watcher script at `/homey-alert.js` and injects it into every Yuvomi page, including before sign-in. The script waits until the tablet is signed in, then places the card over Overview, wall mode and the photo screensaver.

## What a button can do

- **Device:** toggles a boolean capability, presses a button capability, or sends a chosen value. A number with min and max, such as dimming, is pinned with a slider. Devices are grouped by room. The call is `PUT /api/manager/devices/device/:id/capability/:capabilityId` with `{ "value": ... }`.
- **Flow:** `POST /api/manager/flow/flow/:id/trigger`. Advanced flows use `POST /api/manager/flow/advancedflow/:id/trigger`.
- **Webhook:** `GET /webhook?event=&tag=` on the stored Homey address. That is Homey’s own receiver for webhook cards.

The address must be `http` or `https` without username, path or query. Private network addresses are allowed because Homey lives there. Loopback, link-local metadata addresses and names that do not resolve are rejected. `HOMEY_ALLOW_LOOPBACK=1` opens loopback for tests only.

## Permissions

The permission key is `ext:homey`. `none` gets no routes. `read` can see the buttons. `write` pins and runs them. The connection also requires an administrator.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOMEY_GATEWAY_PORT` | `3000` | Port the browser uses |
| `YUVOMI_UPSTREAM` | `http://127.0.0.1:3001` | Yuvomi behind the gateway |
| `YUVOMI_INTERNAL_URL` | same as upstream | Where the session is checked |
| `HOMEY_DATA_DIR` | `data/homey` | Sidecar storage, never `yuvomi.db` |
| `HOMEY_ALLOW_LOOPBACK` | off | Tests only |

Tests: `node --test modules/homey/test/homey.test.js`
