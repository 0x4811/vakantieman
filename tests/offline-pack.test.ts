import { describe, expect, it } from "vitest";
import { buildOfflineHtml, packJson } from "../src/shared/offline-pack";

describe("offline-pakket", () => {
  it("zet de data in het sjabloon en blijft geldige JSON", () => {
    const pack = { a: "</script><b>$&", n: 1 };
    const html = buildOfflineHtml('<script id="pack" type="application/json">__VAKANTIEMAN_PACK__</script>', pack);
    expect(html).not.toContain("</script><b>");
    const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(JSON.parse(inner)).toEqual(pack);
  });
  it("vervangt alleen het data-element, niet dezelfde tekst in de code", () => {
    const html = buildOfflineHtml('<script>const m="__VAKANTIEMAN_PACK__";</script><script id="pack" type="application/json">__VAKANTIEMAN_PACK__</script>', { ok: 1 });
    expect(html).toContain('const m="__VAKANTIEMAN_PACK__"');
    expect(html).toContain('>{"ok":1}</script>');
  });
  it("weigert een sjabloon zonder markering", () => {
    expect(() => buildOfflineHtml("<html></html>", {})).toThrow();
    expect(packJson({ x: "<" })).toBe('{"x":"\\u003c"}');
  });
});
