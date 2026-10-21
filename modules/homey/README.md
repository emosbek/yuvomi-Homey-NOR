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

Skriptet kloner denne grenen til `/opt/yuvomi`, installerer Docker hvis den mangler, og starter Yuvomi pluss portalen. Åpne `http://192.168.1.24:3000` fra en annen enhet på samme nett.

Til utvikling på en PC i samme nett:

```bash
npm run dev:homey
```

Det starter Yuvomi på port 3001 og portalen på port 3000.

3. Åpne Homey i menyen. Lim inn adressen, for eksempel `http://192.168.1.50`, og nøkkelen. Bare en administrator kan lagre den.
4. Fest en enhet, en flyt eller en webhook. Knappen på siden kjører den.

Nøkkelen skrives til `data/homey/state.json` med filrettigheter som bare eieren kan lese. Ingen rute sender den tilbake.

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

Tester: `node --test modules/homey/test/homey.test.js`
