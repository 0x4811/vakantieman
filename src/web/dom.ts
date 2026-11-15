// Kleine DOM-helper: elementen bouwen zonder framework en zonder innerHTML (tekst wordt nooit als HTML gelezen).

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, unknown>;

export function append(parent: ParentNode, children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "dataset" && typeof value === "object") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el && key !== "list" && key !== "form") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function mount(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Element niet gevonden: ${selector}`);
  return el;
}

let toastHost: HTMLElement | null = null;

export function toast(message: string, kind: "info" | "error" | "ok" = "info", ms = 4500): void {
  if (!toastHost) {
    toastHost = h("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const el = h("div", { class: `toast toast--${kind}` }, message);
  toastHost.append(el);
  setTimeout(() => el.remove(), kind === "error" ? Math.max(ms, 7000) : ms);
}

/** Modaal venster; geeft een functie terug om het te sluiten. */
export function openModal(content: HTMLElement, onClose?: () => void): () => void {
  const backdrop = h("div", { class: "modal-backdrop", role: "dialog", "aria-modal": "true" });
  const box = h("div", { class: "modal" }, content);
  backdrop.append(box);
  const close = (): void => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  return close;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
