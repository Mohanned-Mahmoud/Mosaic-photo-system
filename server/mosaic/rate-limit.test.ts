import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "./rate-limit";

describe("public-write rate limits", () => {
  it("allows the configured burst then returns a bounded retry delay", () => {
    const key = `burst-${crypto.randomUUID()}`;
    expect(consumeRateLimit(key, 2, 10_000, 1_000).allowed).toBe(true);
    expect(consumeRateLimit(key, 2, 10_000, 2_000).allowed).toBe(true);
    expect(consumeRateLimit(key, 2, 10_000, 3_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 8,
    });
  });

  it("separates clients and resets an expired window", () => {
    const firstClient = `client-a-${crypto.randomUUID()}`;
    const secondClient = `client-b-${crypto.randomUUID()}`;
    expect(consumeRateLimit(firstClient, 1, 1_000, 1_000).allowed).toBe(true);
    expect(consumeRateLimit(secondClient, 1, 1_000, 1_000).allowed).toBe(true);
    expect(consumeRateLimit(firstClient, 1, 1_000, 2_000).allowed).toBe(true);
  });
});
