#!/usr/bin/env bash
# Install Yuvomi and the Homey gateway on the Raspberry Pi that can see Homey.
# Run it on the Pi, not from Cursor Cloud:
#   curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomi-Homey-NOR/cursor/homey-overview-widget-be88/modules/homey/install-pi.sh | sudo bash
set -euo pipefail

REPO="${YUVOMI_REPO:-https://github.com/emosbek/yuvomi-Homey-NOR.git}"
BRANCH="${YUVOMI_BRANCH:-cursor/homey-overview-widget-be88}"
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

if [ ! -d "${DEST}/.git" ]; then
  rm -rf "$DEST"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$DEST"
else
  git -C "$DEST" fetch --depth 1 origin "$BRANCH"
  git -C "$DEST" checkout -B "$BRANCH" FETCH_HEAD
fi

mkdir -p "${DEST}/data/homey" "${DEST}/backups" "${DEST}/documents"

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

# The gateway loads its code once, at start. A later git checkout does not
# reach the running process, so an update has to recreate the container.
docker compose -f "${DEST}/modules/homey/compose.yml" up -d --pull always --remove-orphans --force-recreate

ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:3000/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "Containers are up, but http://127.0.0.1:3000/health has not answered yet." >&2
  echo "Logs: docker compose -f ${DEST}/modules/homey/compose.yml logs" >&2
  exit 1
fi

echo "Yuvomi is running at http://${HOST}:3000"
echo "Open that address, create an administrator, and paste the Homey address in the module."
