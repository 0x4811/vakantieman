// Vergelijkt beeldmodellen op je eigen testfoto's: afstand tot de echte plek, snelheid en tokens.
//
//   npm run bench -- --providers mock,claude,gemini [--model claude=claude-sonnet-5-5]
//
// Invoer:  testfotos/manifest.json  [{ "label": "Gevel Antwerpen", "file": "a.jpg", "lat": 51.21, "lon": 4.39, "level": "city" }]
//          (JPEG's, al verkleind en zonder metadata: maak ze met de beheerpagina of laat ze als bewerkte foto exporteren)
// Sleutels: ANTHROPIC_API_KEY, GEMINI_API_KEY, CF_ACCOUNT_ID + CF_API_TOKEN uit de omgeving of uit .dev.vars.
// Uitvoer: docs/bench/latest.md (alleen labels, afstanden, tijden en tokens) en bench-output/*.json (ruw, niet in git).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { haversineKm } from "../src/shared/geo";
import { applyRevealLevel } from "../src/shared/levels";
import type { ProviderId, RevealLevel } from "../src/shared/types";
import { inspectJpeg } from "../src/worker/jpeg";
import { createProvider } from "../src/worker/vision";

interface Entry {
  label: string;
  file: string;
  lat: number;
  lon: number;
  level?: RevealLevel;
}

function loadVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...vars, ...(process.env as Record<string, string>) };
}

function parseArgs(argv: string[]): { providers: ProviderId[]; models: Record<string, string> } {
  let providers: ProviderId[] = ["mock"];
  const models: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--providers") providers = (argv[++i] ?? "").split(",").filter(Boolean) as ProviderId[];
    if (argv[i] === "--model") {
      const [id, model] = (argv[++i] ?? "").split("=");
      if (id && model) models[id] = model;
    }
  }
  return { providers, models };
}

async function main(): Promise<void> {
  const root = resolve("testfotos");
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error("testfotos/manifest.json ontbreekt. Zie de kop van scripts/bench.ts.");
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(manifestPath, "utf8")) as Entry[];
  const vars = loadVars();
  const { providers, models } = parseArgs(process.argv.slice(2));
  const config = {
    ANTHROPIC_API_KEY: vars.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: vars.GEMINI_API_KEY,
    CF_ACCOUNT_ID: vars.CF_ACCOUNT_ID,
    CF_API_TOKEN: vars.CF_API_TOKEN
  };

  mkdirSync("bench-output", { recursive: true });
  mkdirSync("docs/bench", { recursive: true });
  const rows: string[] = [];
  const raw: unknown[] = [];

  for (const id of providers) {
    const provider = createProvider(id, config);
    for (const entry of entries) {
      const bytes = new Uint8Array(readFileSync(join(root, entry.file)));
      const check = inspectJpeg(bytes);
      if (!check.ok) {
        rows.push(`| ${entry.label} | ${id} | - | - | - | - | ongeschikt: ${check.reason} |`);
        continue;
      }
      const level = entry.level ?? "city";
      try {
        const result = await provider.analyze({
          imageBase64: Buffer.from(bytes).toString("base64"),
          mime: "image/jpeg",
          width: check.width,
          height: check.height,
          revealLevel: level,
          variant: "original",
          model: models[id]
        });
        const limited = applyRevealLevel(result.analysis, level);
        const top = limited.candidates[0];
        const km = top ? haversineKm(entry.lat, entry.lon, top.lat, top.lon) : null;
        const hit = top ? km! <= Math.max(top.radius_km, 1) : false;
        rows.push(
          `| ${entry.label} | ${id} | ${result.model} | ${km === null ? "-" : km.toFixed(1)} | ${hit ? "ja" : "nee"} | ${(result.latencyMs / 1000).toFixed(1)} s | ${result.inputTokens ?? "-"} / ${result.outputTokens ?? "-"} |`
        );
        raw.push({ label: entry.label, provider: id, model: result.model, analysis: result.analysis });
        console.log(`${id.padEnd(10)} ${entry.label}: ${km === null ? "geen kandidaat" : km.toFixed(1) + " km"}`);
      } catch (error) {
        rows.push(`| ${entry.label} | ${id} | - | - | - | - | fout: ${(error as Error).message.slice(0, 80)} |`);
        console.error(`${id} ${entry.label}: ${(error as Error).message}`);
      }
    }
  }

  const stamp = new Date().toISOString();
  const md = [
    "# Benchmark beeldmodellen",
    "",
    `Uitgevoerd: ${stamp}. Alleen labels, afstanden, tijden en tokens; ruwe antwoorden staan lokaal in bench-output/.`,
    "",
    "| Foto | Provider | Model | Afstand (km) | Binnen straal | Tijd | Tokens in / uit |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    ""
  ].join("\n");
  writeFileSync("docs/bench/latest.md", md);
  writeFileSync(join("bench-output", `${stamp.replace(/[:.]/g, "-")}.json`), JSON.stringify(raw, null, 2));
  console.log("\nGeschreven naar docs/bench/latest.md");
  void dirname;
}

void main();
