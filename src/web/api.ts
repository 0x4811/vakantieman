// API-wrapper: voegt de CSRF-header toe en maakt van foutantwoorden leesbare fouten.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface ApiInit {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined || init.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (method !== "GET") headers["x-requested-with"] = "vakantieman";
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body });
  } catch {
    throw new ApiError("Geen verbinding met de server.", 0);
  }

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // geen JSON
  }
  if (!res.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : res.status === 401 || res.status === 403
          ? "Je sessie is verlopen of je hebt geen toegang. Ververs de pagina."
          : `Fout ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export const photoUrl = (id: string, variant: "original" | "masked" = "original"): string =>
  `/api/photos/${id}/image${variant === "masked" ? "?variant=masked" : ""}`;
