// Wanneer een sessie als vergeten geldt.

const HOUR = 3_600_000;
/** Een live sessie die al zo lang loopt, is vergeten af te sluiten. */
export const LIVE_MAX_HOURS = 12;
/** Een sessie die nooit is gestart, wordt na zoveel dagen opgeruimd. */
export const CREATED_MAX_DAYS = 14;

export function isStale(session: { state: string; created_at: string; started_at: string | null }, now: number): boolean {
  if (session.state === "ended") return false;
  if (session.state === "live") {
    const started = Date.parse(session.started_at ?? session.created_at);
    return Number.isFinite(started) && now - started > LIVE_MAX_HOURS * HOUR;
  }
  const created = Date.parse(session.created_at);
  return Number.isFinite(created) && now - created > CREATED_MAX_DAYS * 24 * HOUR;
}

