# Kids Chores

Weekly kid chores with points, a progress sun (or star) on Overview, midnight reset, and a reward webhook when the daily goal is reached.

This module lives entirely under `modules/kids-chores/`. It does **not** patch Yuvomi core, so your fork can keep syncing with upstream. State is stored in `data/kids-chores/state.json`, never in `yuvomi.db`.

## What it does

- An administrator creates chores (“Wash hands”, “Do homework”) under **Settings → Modules → Kids Chores**.
- Each chore has points and weekday checkboxes (for example Mon–Fri on, Sat–Sun off).
- Completing a chore removes it from the overview widget until after midnight in the household timezone (default `Europe/Oslo`), when it becomes open again.
- Points add up toward a daily goal. The overview mark fills solid with colour by percentage; at 100% it is fully filled.
- When the goal is reached once per day, the sidecar can POST a JSON webhook (Homey / Home Assistant) and leave an admin notice inside the module.
- When every chore for today is done, the configured congratulation message is shown.

## Install on this fork (Raspberry Pi)

The Homey gateway already mounts Kids Chores when the folder is present. Update as usual:

```bash
curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomi-Homey-NOR/cursor/kids-chores-be88/modules/homey/install-pi.sh | sudo bash
```

The script must check out branch `cursor/kids-chores-be88` (its default). If an older run left you on another branch, force it:

```bash
sudo YUVOMI_BRANCH=cursor/kids-chores-be88 bash -c \
  'curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomi-Homey-NOR/cursor/kids-chores-be88/modules/homey/install-pi.sh | bash'
```

Then in Yuvomi: **Settings → Modules → Active modules** → enable **Kids Chores**. Give members `ext:kids-chores` write access under Roles & permissions.

## Webhook payload

`POST` to the URL you configure, `Content-Type: application/json`:

```json
{
  "event": "kids_chores.goal_reached",
  "module": "kids-chores",
  "date": "2026-11-03",
  "earned": 12,
  "goal": 10,
  "percent": 100,
  "timezone": "Europe/Oslo",
  "triggeredBy": "Ada"
}
```

Use that in a Homey Logic webhook flow or a Home Assistant automation.

## Permissions

Key: `ext:kids-chores`. `none` gets no API. `read` can see today’s list. `write` can complete chores. Creating chores and settings requires an administrator.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `KIDS_CHORES_DATA_DIR` | `data/kids-chores` | Sidecar storage |
| `YUVOMI_INTERNAL_URL` | upstream | Where `/api/v1/auth/me` is checked |

Tests: `node --test modules/kids-chores/test/kids-chores.test.js`

## Isolated packaging

Others can copy only this folder into their own `modules/`, or install from GitHub/ZIP via Settings → Add custom module (when `MODULES_ALLOW_WEB_INSTALL=true`). They still need a reverse proxy (or this fork’s Homey gateway) that serves `/api/extensions/kids-chores`.
