# Wijzigingen en terugrollen

Elke fase is één commit op `main`. Tags kunnen vanuit de ontwikkelomgeving niet worden gepusht, dus de commit-hash is het ijkpunt.

| Commit | Inhoud |
|---|---|
| `b634cf6` | Ontwerp, README, .gitignore |
| `79ae55d` | Fase 1 deel 1: kern, wisselbare vision-laag, API |
| `9e56bbe` | Fase 1 deel 2: beheerpagina, kaart, beeldbewerking |
| `3962104` | Fase 2: sessies, sessiekamer, presentatie, bediening |
| `efba76e` | Fase 3: publieke stem-Worker en stempagina |
| `8fecfdf` | Fase 4: onzichtbaar maken |
| `53d28fe` | Fase 5a: offline-speler |
| `7ded91a` | Fase 5b: alles wissen, opruiming, bench, CI |

## Terugrollen

Code (veilig, bewaart de geschiedenis):

```bash
git revert --no-edit <commit>..HEAD   # of: git revert <commit>
git push origin main
```

Wil je tijdelijk een oude stand bekijken: `git switch --detach <commit>`.

Deployment (direct, zonder git): `npx wrangler rollback` op de hoofd-Worker, en `npx wrangler rollback -c wrangler.vote.jsonc` op de stem-Worker.

Databaseschema: migraties zijn alleen aanvullend. Een terugrol van de code laat het schema staan; dat is veilig zolang nieuwe kolommen optioneel zijn.
