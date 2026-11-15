// Offline-pakket: sessiescript en foto's worden in de offline-speler (één HTML-bestand) gezet.

export const PACK_MARKER = "__VAKANTIEMAN_PACK__";
// Alleen de markering in het data-element wordt vervangen, niet dezelfde tekst in de ingebouwde code.
const PACK_SLOT = `type="application/json">${PACK_MARKER}</script>`;

/** JSON die veilig in een script-element past: "<" en regelscheidingstekens worden geëscaped. */
export function packJson(pack: unknown): string {
  return JSON.stringify(pack)
    .replace(/</g, "\\u003c")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

export function buildOfflineHtml(template: string, pack: unknown): string {
  if (!template.includes(PACK_SLOT)) throw new Error("De offline-speler is niet gebouwd. Voer 'npm run build' uit.");
  // Functie als vervanger: "$&" en dergelijke in de data mogen niet als patroon worden gelezen.
  return template.replace(PACK_SLOT, () => `type="application/json">${packJson(pack)}</script>`);
}
