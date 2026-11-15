import { describe, expect, it } from "vitest";
import { CREATED_MAX_DAYS, isStale, LIVE_MAX_HOURS } from "../src/shared/stale";

const now = Date.parse("2026-11-15T12:00:00Z");
const ago = (ms: number): string => new Date(now - ms).toISOString();
const H = 3_600_000;

describe("verlopen sessies", () => {
  it("laat afgesloten sessies met rust", () => {
    expect(isStale({ state: "ended", created_at: ago(999 * 24 * H), started_at: null }, now)).toBe(false);
  });
  it("sluit een te lang lopende live sessie af", () => {
    expect(isStale({ state: "live", created_at: ago(30 * H), started_at: ago((LIVE_MAX_HOURS + 1) * H) }, now)).toBe(true);
    expect(isStale({ state: "live", created_at: ago(30 * H), started_at: ago(2 * H) }, now)).toBe(false);
  });
  it("ruimt een nooit gestarte sessie na de termijn op", () => {
    expect(isStale({ state: "created", created_at: ago((CREATED_MAX_DAYS + 1) * 24 * H), started_at: null }, now)).toBe(true);
    expect(isStale({ state: "created", created_at: ago(2 * 24 * H), started_at: null }, now)).toBe(false);
  });
});
