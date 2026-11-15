// WebSocket-verbinding met de sessiekamer, met automatisch opnieuw verbinden.

import type { Action, ClientMessage, ServerMessage } from "../shared/session";

export interface LiveHandlers {
  onMessage(message: ServerMessage): void;
  onStatus(online: boolean): void;
}

export interface Live {
  send(action: Action): void;
  close(): void;
}

export function connectLive(code: string, role: "present" | "control", handlers: LiveHandlers): Live {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let pingTimer: number | undefined;
  let retryTimer: number | undefined;

  const open = (): void => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${location.host}/ws/${code}?role=${role}`);
    socket.addEventListener("open", () => {
      attempt = 0;
      handlers.onStatus(true);
      // De sessiekamer beantwoordt "ping" automatisch, ook als hij slaapt.
      pingTimer = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 25_000);
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      try {
        handlers.onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        /* onleesbaar bericht negeren */
      }
    });
    const lost = (): void => {
      window.clearInterval(pingTimer);
      handlers.onStatus(false);
      if (closed) return;
      attempt++;
      retryTimer = window.setTimeout(open, Math.min(8000, 400 * 2 ** Math.min(attempt, 5)));
    };
    socket.addEventListener("close", lost);
    socket.addEventListener("error", () => socket?.close());
  };
  open();

  return {
    send(action) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const message: ClientMessage = { t: "action", action };
      socket.send(JSON.stringify(message));
    },
    close() {
      closed = true;
      window.clearInterval(pingTimer);
      window.clearTimeout(retryTimer);
      socket?.close();
    }
  };
}

/** Sessiecode uit het pad (/present/ABCDE of /control/ABCDE). */
export function codeFromPath(): string {
  return (location.pathname.split("/").filter(Boolean)[1] ?? "").toUpperCase();
}
