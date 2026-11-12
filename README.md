# vakantieman

Demo voor awarenesssessies en keynotes. Het publiek raadt waar Wouter is op een selfie. Daarna laat de tool zien dat een beeldmodel de plek kan afleiden uit wat er te zien is, en welke details dat mogelijk maakten. De clou: die details zijn te verbergen.

**Status:** ontwerpfase. Zie [docs/ONTWERP.md](docs/ONTWERP.md).

## Uitgangspunten

- Alleen eigen selfies, nooit foto's van anderen.
- Privé-repo en gesloten gereedschap: uploaden, beheer en bediening zitten achter een inlog.
- Foto's worden zonder metadata (EXIF, GPS) geüpload, dus de tool werkt alleen met wat te zien is.
- Het beeldmodel (Claude, Gemini, Workers AI) is een instelling en makkelijk te wisselen.
- Elke werkende fase krijgt een tag, zodat terugrollen altijd kan.

## Geheimen

API-sleutels en tokens staan nooit in deze repo. Lokaal in `.dev.vars` (staat in `.gitignore`), op Cloudflare als Worker-secrets en in GitHub Actions-secrets.
