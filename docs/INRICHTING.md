# Inrichting op Cloudflare

Doel: de tool draait op jouw eigen Cloudflare-account en is bereikbaar vanaf elk apparaat. Volgorde doet ertoe.

## 0. Wat ik van je nodig heb

- Welk Cloudflare-account (mail@wouterslotboom.nl of mail@wwwouter.nl; niet dat van Stijn).
- Een API-token (Workers, D1, R2 bewerken) en het account-ID, alleen voor GitHub Actions of lokaal deployen.
- `ANTHROPIC_API_KEY` en/of `GEMINI_API_KEY`. Zonder sleutels werkt alleen de mock-provider.
- 10 tot 15 eigen testfoto's voor de vergelijking (zie stap 8).

## 1. Opslag aanmaken

```bash
npx wrangler login                       # kies het juiste account
npx wrangler d1 create vakantieman       # kopieer de database_id naar wrangler.jsonc
npx wrangler r2 bucket create vakantieman-photos
npm run db:migrate:remote
```

## 2. Instellingen

In `wrangler.jsonc`: vul `database_id` in. Kies `VISION_PROVIDER` (`claude`, `gemini`, `workers-ai` of `mock`) en eventueel `VISION_MODEL`.
Controleer de modelnaam van Gemini in AI Studio voordat je hem gebruikt; de standaard in de code kan verouderd zijn.

Geheimen (nooit in git):

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GEMINI_API_KEY       # optioneel
```

Privéfoto's gaan standaard alleen naar `claude` en `mock` (`PRIVATE_PROVIDERS`). Gemini wordt pas toegelaten met `GEMINI_PAID=true` (betaald project).

## 3. Eerste deployment

```bash
npm run build:web
npx wrangler deploy                          # hoofd-Worker (nog zonder Access)
npx wrangler deploy -c wrangler.vote.jsonc   # stem-Worker
```

Noteer de twee workers.dev-adressen. Zet het adres van de stem-Worker in `PUBLIC_VOTE_URL` (`wrangler.jsonc`, `vars`) en deploy de hoofd-Worker opnieuw.

## 4. Beveiliging: Cloudflare Access (verplicht)

Zonder deze stap weigert de Worker alle verzoeken (hij faalt dicht), behalve `/healthz`.

1. Zero Trust, Access, Applications, Add, Self-hosted. Domein: het workers.dev-adres van de **hoofd-Worker** (niet de stem-Worker).
2. Policy: Allow, alleen jouw e-mailadres(sen).
3. Kopieer de Application Audience (AUD) en je team-domein (`<team>.cloudflareaccess.com`).
4. Zet in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN` en `ACCESS_AUD`. Deploy opnieuw.

Controle: open `/admin` in een privévenster; je moet eerst een inlogscherm krijgen. `/healthz` is openbaar.

## 5. GitHub Actions

Repository, Settings, Secrets and variables, Actions:

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Variabele `DEPLOY_ENABLED` = `true` om bij elke push naar `main` automatisch te deployen. Zonder deze variabele draait alleen CI; deployen kan altijd handmatig via de workflow "Deploy".

## 6. Dag van de presentatie

1. Beheer: maak een sessie en open de presentatie (beamer) en de bediening (telefoon, QR in beheer).
2. Download het **offline-pakket** als reserve en test het zonder internet.
3. Presenteer: Volgende opent de raadronde; het publiek scant de QR-code op het scherm.
4. Sluit de sessie af: stemmen worden gewist, alleen een samenvatting blijft.

## 7. Terugrollen

Zie [CHANGELOG.md](../CHANGELOG.md).

## 8. Modelvergelijking

Zet je testfoto's (JPEG, al verkleind en zonder metadata, bijvoorbeeld via beheer geëxporteerd) in `testfotos/` met een `manifest.json`:

```json
[{ "label": "Gevel", "file": "gevel.jpg", "lat": 51.2125, "lon": 4.3952, "level": "city" }]
```

```bash
npm run bench -- --providers claude,gemini,mock
```

Resultaat: `docs/bench/latest.md` (alleen labels, afstanden, tijden, tokens). Ruwe antwoorden blijven lokaal.
