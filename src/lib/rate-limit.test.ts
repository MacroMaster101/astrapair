import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per key within the window", () => {
    let t = 0;
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => t,
    });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(true);
    t = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  it("resets limit after window passes and behavior is unchanged on repeated checks", () => {
    let t = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 100,
      now: () => t,
    });
    expect(limiter.check("x")).toBe(true);
    expect(limiter.check("x")).toBe(false);
    t = 101;
    expect(limiter.check("x")).toBe(true);
    expect(limiter.check("x")).toBe(false);
    t = 202;
    expect(limiter.check("x")).toBe(true);
  });
});

describe("createRateLimiter maxKeys", () => {
  it("holds no more than maxKeys keys and drops the oldest first", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => 0,
      maxKeys: 2,
    });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    // "c" pushes out "a", the oldest.
    expect(limiter.check("c")).toBe(true);
    expect(limiter.check("b")).toBe(false);
    expect(limiter.check("c")).toBe(false);
    // "a" was dropped, so it is treated as new (and in turn pushes out "b").
    expect(limiter.check("a")).toBe(true);
  });

  it("drops expired keys before it drops a live one", () => {
    let t = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 100,
      now: () => t,
      maxKeys: 2,
    });
    expect(limiter.check("old")).toBe(true);
    t = 90;
    expect(limiter.check("live")).toBe(true);
    t = 150;
    // "old" has expired, so "live" must survive the new key.
    expect(limiter.check("new")).toBe(true);
    expect(limiter.check("live")).toBe(false);
    expect(limiter.check("new")).toBe(false);
  });

  it("does not evict anything when an existing key is checked at the cap", () => {
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => 0,
      maxKeys: 2,
    });
    limiter.check("a");
    limiter.check("b");
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(true);
  });

  it("has no cap by default", () => {
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => 0,
    });
    for (let i = 0; i < 500; i += 1) limiter.check(`k${i}`);
    expect(limiter.check("k0")).toBe(false);
  });
});
