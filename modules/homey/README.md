# Homey

Knapper og funksjoner fra Homey Pro, festet i Yuvomi.

Modulen er nettleserkode. Adressen og API-nøkkelen ligger i en egen tjeneste, ikke i Yuvomi og ikke i nettleseren. Tjenesten svarer på `/api/extensions/homey`. Yuvomi kjører ikke modulens serverfiler selv, så en reverse proxy må sende den stien hit. `gateway.js` gjør det på denne maskinen: den tar imot porten husstanden bruker, svarer selv på Homey-stien, og sender alt annet videre til Yuvomi.

## Koble til

1. I Homey: Innstillinger → API-nøkler. Nøkkelen trenger lesing og styring av enheter. Skal flyter kunne festes, trenger den også lesing og start av flyter.
2. Kjør appen på en maskin i samme nett som Homey. Forhåndsvisningen i Cursor Cloud er en tunnel: nettleseren treffer `127.0.0.1:3000`, mens prosessen står i skyen og når ikke `192.168.x.x`.

På Raspberry Pi-en (standardadresse `192.168.1.24`):

```bash
curl -fsSL https://raw.githubusercontent.com/emosbek/yuvomiMo/cursor/homey-module-a566/modules/homey/install-pi.sh | sudo bash
```

Skriptet kloner denne grenen til `/opt/yuvomi`, installerer Docker hvis den mangler, og starter Yuvomi pluss portalen. Kjør den samme kommandoen igjen etter en oppdatering. Portalen leser koden bare når beholderen starter, så skriptet lager den på nytt. Åpne `http://192.168.1.24:3000` fra en annen enhet på samme nett.

Til utvikling på en PC i samme nett:

```bash
npm run dev:homey
```

Det starter Yuvomi på port 3001 og portalen på port 3000.

3. Åpne Homey i menyen. Lim inn adressen, for eksempel `http://192.168.1.50`, og nøkkelen. Bare en administrator kan lagre den.
4. Fest en enhet, en flyt eller en webhook. Knappen på siden kjører den.

Nøkkelen skrives til `data/homey/state.json` med filrettigheter som bare eieren kan lese. Ingen rute sender den tilbake.

## Ringeklokke

På Homey-siden lager en administrator en ringeadresse. Den vises bare én gang. En Homey-flyt kaller den med GET når ringeklokken trykkes, for eksempel når UniFi Protect melder at noen har trykket på G6 Entry Pro:

`http://192.168.1.24:3000/api/extensions/homey/ring?token=…`

Nettbrettet som har Yuvomi åpen, legger et kort over hele skjermen, også over fotobildeskjermspareren. Kortet forsvinner av seg selv etter 30 sekunder. Et trykk på Lukk, eller Escape, lukker det før det.

Under ringeklokken velger du kamera, eller lar listen stå på automatisk. Da brukes dørklokken i Homey, for eksempel UniFi G6 Entry Pro. «Test varsel og bilde» viser kortet med det bildet, uten at ringeklokken eller klokkene brukes. Bildet oppdateres mens kortet er oppe. Samme bilde vises når Homey-flyten kaller ringeadressen.

Bildet hentes fra Homey med API-nøkkelen som allerede er lagret. Hvis enheten har en IP-adresse, prøves kameraets eget øyeblikksbilde først. Ellers brukes bildet UniFi Protect har lagret i Homey. Det bildet kan være noen sekunder gammelt. RTSP kan ikke spilles i nettleseren. En annen http- eller https-adresse kan limes inn hvis Homey ikke har et bilde. Adressen, kameraets IP og API-nøkkelen sendes ikke til nettleseren, og bildet hentes bare mens kortet er oppe.

Adressen er en nøkkel. Den som har den, kan utløse kortet. Veggmodus laster ikke moduler selv. Porten serverer derfor vakt-skriptet selv på `/homey-alert.js` og legger det inn i hver Yuvomi-side, også før innlogging. Skriptet venter til nettbrettet er logget inn, og legger kortet over oversikten, veggen og fotobildeskjermspareren.

## Hva en knapp kan gjøre

- **Enhet:** slår av og på en boolsk evne, trykker en knapp-evne, eller sender en valgt verdi. Et tall med min og maks, som dimming, festes med en skyveknapp. Enhetene står samlet per rom. Kallet er `PUT /api/manager/devices/device/:id/capability/:capabilityId` med `{ "value": ... }`.
- **Flyt:** `POST /api/manager/flow/flow/:id/trigger`. Avanserte flyter bruker `POST /api/manager/flow/advancedflow/:id/trigger`.
- **Webhook:** `GET /webhook?event=&tag=` på den lagrede Homey-adressen. Det er Homey sin egen mottaker for webhook-kort.

Adressen må være `http` eller `https` uten brukernavn, sti eller spørring. Private nettadresser er tillatt, fordi Homey står der. Loopback, lenkelokale metadata-adresser og navn som ikke lar seg slå opp, avvises. `HOMEY_ALLOW_LOOPBACK=1` åpner loopback bare for tester.

## Rettigheter

Rettigheten heter `ext:homey`. `none` får ingen ruter. `read` ser knappene. `write` fester og kjører dem. Tilkoblingen krever i tillegg administrator.

## Variabler

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `HOMEY_GATEWAY_PORT` | `3000` | Porten nettleseren bruker |
| `YUVOMI_UPSTREAM` | `http://127.0.0.1:3001` | Yuvomi bak portalen |
| `YUVOMI_INTERNAL_URL` | samme som upstream | Der sesjonen sjekkes |
| `HOMEY_DATA_DIR` | `data/homey` | Egen lagring, aldri `yuvomi.db` |
| `HOMEY_ALLOW_LOOPBACK` | av | Bare for tester |
| `RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK` | `true` via install | Lar Yuvomi speile Mealie/Tandoor på LAN |
| `OIKOS_HTTP_PORT` | `3001` via install | Host-port for Yuvomi; må ikke være `3000` mens Homey kjører |

## Porter

| Port på Pi | Prosess |
| --- | --- |
| `3000` | Homey-gateway (nettleseren) |
| `3001` → container `3000` | Yuvomi (bare `127.0.0.1`) |

Bruk bare `modules/homey/compose.yml` på denne Pi-en. Rotfilen `docker-compose.yml` mapper `${OIKOS_HTTP_PORT:-3000}:3000` og tar Homeys port hvis `OIKOS_HTTP_PORT` mangler eller er `3000`.

## Feilsøk

### `{"error":"Yuvomi is not reachable.","code":502,"reason":"upstream"}`

Homey-portalen får ikke kontakt med Yuvomi på `YUVOMI_UPSTREAM` (`http://127.0.0.1:3001`). Vanlig årsak på denne Pi-en: Yuvomi ble startet på host-port **3000** (ofte via rot-`docker-compose.yml` eller `OIKOS_HTTP_PORT=3000`), så den kolliderte med Homey og ble ikke lyttende på `3001`. Det er ikke Tandoor, og ikke `RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK`.

```bash
sudo grep '^OIKOS_HTTP_PORT=' /opt/yuvomi/.env
# forventet: OIKOS_HTTP_PORT=3001
ss -lntp | grep -E '3000|3001'
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:3000/__homey/health
sudo docker compose -f /opt/yuvomi/modules/homey/compose.yml ps
sudo docker compose -f /opt/yuvomi/modules/homey/compose.yml logs --tail=80 yuvomi homey
sudo docker compose -f /opt/yuvomi/modules/homey/compose.yml up -d --force-recreate
```

`/__homey/health` svarer fra portalen selv. Hvis den sier `upstreamOk: false`, er Yuvomi nede eller ikke publisert på `127.0.0.1:3001`.

### Tandoor / Mealie sier privat nett eller får ikke kontakt

1. Variabelen må ligge i `/opt/yuvomi/.env` **og** inne i containeren:

```bash
sudo grep '^RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK=' /opt/yuvomi/.env
sudo docker exec yuvomi-yuvomi-1 printenv RECIPE_PROVIDER_ALLOW_PRIVATE_NETWORK
```

Hvis `.env` har `true` men `printenv` er tom, kjør `docker compose ... up -d --force-recreate yuvomi`.

2. Bruk ikke `http://127.0.0.1:8085` som serveradresse i Yuvomi. Derfra er `127.0.0.1` Yuvomi-containeren selv. Bruk Pi-ens LAN-adresse, for eksempel `http://192.168.1.24:8085`.

3. Hvis Tandoor bare er publisert som `127.0.0.1:8085->80`, når ingen annen container den. Endre i Tandoors compose til `0.0.0.0:8085:80` (eller bare `8085:80`), start Tandoor på nytt, og bruk LAN-adressen i Yuvomi.

Tester: `node --test modules/homey/test/homey.test.js`
