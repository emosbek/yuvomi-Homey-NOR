#!/usr/bin/env bash
# Install Yuvomi and the Homey gateway on the Raspberry Pi that can see Homey.
# Run it on the Pi, not from Cursor Cloud:
#   curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomi-Homey-NOR/cursor/homey-ui-polish-5293/modules/homey/install-pi.sh | sudo bash
set -euo pipefail

REPO="${YUVOMI_REPO:-https://github.com/emosbek/yuvomi-Homey-NOR.git}"
# Default matches this file's branch. Override with YUVOMI_BRANCH=… if needed.
BRANCH="${YUVOMI_BRANCH:-cursor/homey-ui-polish-5293}"
DEST="${YUVOMI_DIR:-/opt/yuvomi}"
HOST="${YUVOMI_HOST:-192.168.1.24}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script with sudo on the Raspberry Pi." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  aarch64|arm64|x86_64) ;;
  *)
    echo "This machine is ${arch}. The Yuvomi image exists for arm64 and amd64." >&2
    exit 1
    ;;
esac

if ! hostname -I | tr ' ' '\n' | grep -qx "$HOST"; then
  echo "Address ${HOST} is not on this machine." >&2
  echo "Run the script on the Pi, or set YUVOMI_HOST to the address it actually has." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y git curl openssl ca-certificates
fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "Installing from ${REPO} branch ${BRANCH} into ${DEST}"

if [ ! -d "${DEST}/.git" ]; then
  rm -rf "$DEST"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$DEST"
else
  git -C "$DEST" fetch --depth 1 origin "$BRANCH"
  git -C "$DEST" checkout -B "$BRANCH" FETCH_HEAD
fi

mkdir -p "${DEST}/data/homey" "${DEST}/data/kids-chores" "${DEST}/backups" "${DEST}/documents"

if [ ! -d "${DEST}/modules/kids-chores" ]; then
  echo "Kids Chores folder is missing from this checkout (${DEST}/modules/kids-chores)." >&2
  echo "Branch ${BRANCH} is incomplete. Re-run after Kids Chores is merged into it." >&2
  exit 1
fi

if [ ! -d "${DEST}/modules/homey" ]; then
  echo "Homey folder is missing from this checkout (${DEST}/modules/homey)." >&2
  exit 1
fi

if [ ! -f "${DEST}/.env" ]; then
  umask 077
  cat > "${DEST}/.env" <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
DB_ENCRYPTION_KEY=$(openssl rand -hex 32)
BASE_URL=http://${HOST}:3000
SESSION_SECURE=false
TRUST_PROXY=loopback
NODE_ENV=production
EOF
  chmod 600 "${DEST}/.env"
  echo "Created ${DEST}/.env. Keep that file. The database cannot be opened without the key in it."
fi

# Refuse a placeholder or empty secret before Docker hides the real error.
if ! grep -qE '^SESSION_SECRET=[^[:space:]]+' "${DEST}/.env"; then
  echo "${DEST}/.env is missing SESSION_SECRET. Restore it or recreate carefully." >&2
  exit 1
fi
if grep -qE '^SESSION_SECRET=REPLACE_WITH_' "${DEST}/.env"; then
  echo "${DEST}/.env still has the example SESSION_SECRET placeholder." >&2
  exit 1
fi

COMPOSE=(docker compose -f "${DEST}/modules/homey/compose.yml")

dump_yuvomi() {
  echo "--- compose ps ---" >&2
  "${COMPOSE[@]}" ps >&2 || true
  echo "--- yuvomi logs (last 160) ---" >&2
  "${COMPOSE[@]}" logs yuvomi --tail 160 >&2 || true
  echo "--- inspect State ---" >&2
  docker inspect "$("${COMPOSE[@]}" ps -q yuvomi 2>/dev/null | head -1)" \
    --format 'status={{.State.Status}} exit={{.State.ExitCode}} err={{.State.Error}} oom={{.State.OOMKilled}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    2>&1 >&2 || true
  echo "--- curl :3001/health ---" >&2
  curl -sS -m 3 "http://127.0.0.1:3001/health" >&2 || true
  echo >&2
}

# Build Yuvomi from this checkout (MET Norway, hourly weather, Homey-NOR UI),
# then recreate. Do not `--pull always` an upstream image — that skips the
# fork's server/ and public/ and was why weather vanished after an "update".
"${COMPOSE[@]}" build yuvomi

# Start Yuvomi alone first so a crash is visible before the gateway.
"${COMPOSE[@]}" up -d --remove-orphans --force-recreate yuvomi
sleep 3
if ! "${COMPOSE[@]}" ps yuvomi --format '{{.Status}}' 2>/dev/null | grep -qiE 'up|running|healthy|starting'; then
  echo "Yuvomi did not stay up after create." >&2
  dump_yuvomi
  exit 1
fi

echo "Waiting for Yuvomi on http://127.0.0.1:3001/health …"
ok=0
for i in $(seq 1 90); do
  if curl -fs --connect-timeout 1 "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  status="$("${COMPOSE[@]}" ps yuvomi --format '{{.Status}}' 2>/dev/null || true)"
  case "$status" in
    *Exit*|*exited*|*Dead*|*dead*)
      echo "Yuvomi stopped during startup (${status})." >&2
      dump_yuvomi
      exit 1
      ;;
  esac
  if [ $((i % 15)) -eq 0 ]; then
    echo "  still waiting (${i}/90)… status: ${status:-unknown}"
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "Yuvomi did not answer http://127.0.0.1:3001/health in time." >&2
  dump_yuvomi
  exit 1
fi

echo "Yuvomi is healthy on :3001 — starting Homey gateway…"
"${COMPOSE[@]}" up -d --remove-orphans --force-recreate homey

ok=0
for _ in $(seq 1 45); do
  if curl -fs --connect-timeout 1 "http://127.0.0.1:3000/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "Gateway did not answer http://127.0.0.1:3000/health." >&2
  dump_yuvomi
  echo "--- homey gateway logs ---" >&2
  "${COMPOSE[@]}" logs homey --tail 80 >&2 || true
  exit 1
fi

echo "Yuvomi is running at http://${HOST}:3000"
echo "Modules on disk: $(ls -1 "${DEST}/modules" | tr '\n' ' ')"
echo "Git: $(git -C "$DEST" rev-parse --short HEAD) on $(git -C "$DEST" branch --show-current)"
echo "Open Settings → Modules → Active modules and enable Homey / Kids Chores if needed."
