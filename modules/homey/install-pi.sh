#!/usr/bin/env bash
# Install Yuvomi and the Homey gateway on the Raspberry Pi that can see Homey.
# Run it on the Pi, not from Cursor Cloud:
#   curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomiMo/cursor/homey-module-a566/modules/homey/install-pi.sh | sudo bash
set -euo pipefail

REPO="${YUVOMI_REPO:-https://github.com/emosbek/yuvomiMo.git}"
BRANCH="${YUVOMI_BRANCH:-cursor/homey-module-a566}"
DEST="${YUVOMI_DIR:-/opt/yuvomi}"
HOST="${YUVOMI_HOST:-192.168.1.24}"
COMPOSE_FILE="${DEST}/modules/homey/compose.yml"

if [ "$(id -u)" -ne 0 ]; then
  echo "Kjør skriptet med sudo på Raspberry Pi-en." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  aarch64|arm64|x86_64) ;;
  *)
    echo "Denne maskinen er ${arch}. Yuvomi-imaget finnes for arm64 og amd64." >&2
    exit 1
    ;;
esac

if ! hostname -I | tr ' ' '\n' | grep -qx "$HOST"; then
  echo "Adressen ${HOST} ligger ikke på denne maskinen." >&2
  echo "Kjør skriptet på Pi-en, eller sett YUVOMI_HOST til adressen den faktisk har." >&2
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

ensure_env_line() {
  local key="$1"
  local value="$2"
  local file="${DEST}/.env"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    return 0
  fi
  printf '%s=%s\n' "$key" "$value" >>"$file"
  echo "La til ${key}=${value} i ${file}"
}

# Homey owns host :3000. Yuvomi must stay on host :3001 (see compose.yml).
# If OIKOS_HTTP_PORT is 3000 (root compose default), a later
# `docker compose -f /opt/yuvomi/docker-compose.yml up` steals Homey's port
# and the gateway answers 502 "Yuvomi is not reachable".
set_env_value() {
  local key="$1"
  local value="$2"
  local file="${DEST}/.env"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local current
    current="$(sed -n "s/^${key}=//p" "$file" | head -n1)"
    if [ "$current" = "$value" ]; then
      return 0
    fi
    sed -i "s/^${key}=.*/${key}=${value}/" "$file"
    echo "Satte ${key}=${value} i ${file} (var ${current})"
    return 0
  fi
  printf '%s=%s\n' "$key" "$value" >>"$file"
  echo "La til ${key}=${value} i ${file}"
}

if [ ! -f "${DEST}/.env" ]; then
  umask 077
  cat > "${DEST}/.env" <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
DB_ENCRYPTION_KEY=$(openssl rand -hex 32)
BASE_URL=http://${HOST}:3000
SESSION_SECURE=false
TRUST_PROXY=loopback
NODE_ENV=production
OIKOS_HTTP_PORT=3001
RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK=true
EOF
  chmod 600 "${DEST}/.env"
  echo "Ny ${DEST}/.env. Ta vare på filen. Databasen kan ikke åpnes uten nøkkelen i den."
else
  # Force the Homey port split even on an existing .env that still has the
  # root-compose default 3000 (that is what took Yuvomi down on this Pi).
  set_env_value OIKOS_HTTP_PORT 3001
  # LAN Pi installs almost always mirror Mealie/Tandoor on a private address.
  # Without this switch the settings form refuses the URL; with it set only in
  # .env on disk but not recreated into the container, the running process still
  # refuses. install always recreates below, so appending here is enough.
  ensure_env_line RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK true
fi

# The gateway loads its code once, at start. A later git checkout does not
# reach the running process, so an update has to recreate the container.
# --env-file points Compose at /opt/yuvomi/.env for any ${VAR} substitution in
# compose.yml. Container env for Yuvomi still comes from env_file: ../../.env.
docker compose --env-file "${DEST}/.env" -f "$COMPOSE_FILE" up -d --pull always --remove-orphans --force-recreate

ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:3001/health" >/dev/null \
    && curl -fsS "http://127.0.0.1:3000/__homey/health" >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" -ne 1 ]; then
  echo "Containerne er startet, men Homey-gatewayen når ikke Yuvomi ennå." >&2
  echo "Sjekk: curl -s http://127.0.0.1:3001/health" >&2
  echo "Sjekk: curl -s http://127.0.0.1:3000/__homey/health" >&2
  echo "Logg: docker compose -f ${COMPOSE_FILE} logs --tail=100" >&2
  exit 1
fi

echo "Yuvomi kjører på http://${HOST}:3000"
echo "Gateway-helse: curl -s http://${HOST}:3000/__homey/health"
echo "Tandoor/Mealie: bruk http://${HOST}:<port> (ikke 127.0.0.1 inne i Yuvomi), og publiser tjenesten på 0.0.0.0 hvis den bare lytter på loopback."
echo "Åpne http://${HOST}:3000, lag en administrator, og lim inn Homey-adressen i modulen."
