# vakantieman

Demo voor awarenesssessies en keynotes. Het publiek raadt waar Wouter is op een selfie. Daarna laat de tool zien dat een beeldmodel de plek kan afleiden uit wat er te zien is, en welke details dat mogelijk maakten. De clou: die details zijn te verbergen.

**Status:** alle vijf fasen zijn gebouwd en lokaal getest (met de mock-provider). Nog te doen door Wouter: Cloudflare-account kiezen, API-sleutels en testfoto's aanleveren. Zie [docs/INRICHTING.md](docs/INRICHTING.md).

## Onderdelen

| Onderdeel | Waar | Wat |
|---|---|---|
| Beheer | `/admin` (achter Access) | foto's, analyses, goedkeuren, onzichtbaar maken, sessies, offline-pakket |
| Presentatie | `/present/CODE` | scherm voor de beamer, toetsenbord als klikker |
| Bediening | `/control/CODE` | telefoon: volgende/vorige, raadronde, zwart scherm, afsluiten |
| Stempagina | `vakantieman-vote` Worker, `/v/CODE` | publiek raadt via QR-code, zonder inlog |
| Offline-speler | `/offline-player` + export | los HTML-bestand met foto en script, werkt zonder internet |

## Uitgangspunten

- Alleen eigen selfies, nooit foto's van anderen.
- Privé-repo en gesloten gereedschap: uploaden, beheer en bediening zitten achter een inlog (Cloudflare Access). Alleen de stempagina is openbaar en kan niets anders dan stemmen.
- Foto's worden in de browser opnieuw gecodeerd en zijn dus zonder metadata (EXIF, GPS); de server controleert dat nogmaals.
- Het beeldmodel (Claude, Gemini, Workers AI, mock) is een instelling en makkelijk te wisselen.
- Stemmen worden niet bewaard: bij afsluiten blijft alleen een samenvatting over.
- Elke fase is een commit; terugrollen staat in [CHANGELOG.md](CHANGELOG.md).

## Lokaal draaien

```bash
npm install
cp .dev.vars.example .dev.vars      # pas aan; DEV_AUTH_BYPASS=1 werkt alleen op localhost
npm run db:migrate:local
npm run build:web
npm run dev                          # beheer op http://localhost:8787/admin
npm run dev:vote                     # tweede terminal: stempagina op http://localhost:8788
npm test && npm run e2e              # e2e vraagt beide Workers
```

## Geheimen

API-sleutels en tokens staan nooit in deze repo. Lokaal in `.dev.vars` (staat in `.gitignore`), op Cloudflare als Worker-secrets en in GitHub Actions-secrets.
