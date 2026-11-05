import { describe, it, expect, afterEach, vi } from "vitest";
import { detectRateLimit, parseResetTime } from "../src/ratelimit.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("detectRateLimit", () => {
  it.each([
    ["5-hour limit reached", "Claude Code 5-hour limit reached"],
    ["usage limit", "You have hit your usage limit reached for now"],
    ["rate limit", "Error: rate limit reached, try later"],
    ["claude.ai usage limit", "claude.ai usage limit will reset soon"],
    ["too many requests", "HTTP error: Too Many Requests"],
    ["quota exceeded", "API quota exceeded for this org"],
    ["http 429", "request failed with status 429"],
  ])("detects %s", (_label, output) => {
    expect(detectRateLimit(output)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectRateLimit("USAGE LIMIT REACHED")).toBe(true);
  });

  it("matches when the message is embedded in surrounding log output", () => {
    const log = ["> running task", "5-hour limit reached - resets 3:45 PM", "> exiting"].join("\n");
    expect(detectRateLimit(log)).toBe(true);
  });

  it("ignores ordinary output", () => {
    expect(detectRateLimit("All tests passed in 429ms")).toBe(false);
    expect(detectRateLimit("Build succeeded")).toBe(false);
    expect(detectRateLimit("")).toBe(false);
  });

  it("does not treat 429 inside a longer number as a status code", () => {
    expect(detectRateLimit("processed 14290 records")).toBe(false);
  });
});

describe("parseResetTime", () => {
  it("returns null when the output carries no reset time", () => {
    expect(parseResetTime("5-hour limit reached")).toBeNull();
  });

  it("parses a 12-hour time with a PM suffix", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T10:00:00"));

    const reset = parseResetTime("5-hour limit reached - resets 3:45 PM");

    expect(reset?.getHours()).toBe(15);
    expect(reset?.getMinutes()).toBe(45);
  });

  it("parses a 24-hour time after 'resets at'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T10:00:00"));

    const reset = parseResetTime("usage limit reached, resets at 15:45");

    expect(reset?.getHours()).toBe(15);
    expect(reset?.getMinutes()).toBe(45);
  });

  it("maps 12 AM to midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T10:00:00"));

    expect(parseResetTime("resets 12:30 AM")?.getHours()).toBe(0);
  });

  it("keeps 12 PM as noon", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T08:00:00"));

    expect(parseResetTime("resets 12:30 PM")?.getHours()).toBe(12);
  });

  it("rolls over to tomorrow when the reset time has already passed today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T20:00:00"));

    const reset = parseResetTime("resets 3:45 PM");

    expect(reset?.getDate()).toBe(6);
    expect(reset?.getHours()).toBe(15);
  });

  it("stays on today when the reset time is still ahead", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T09:00:00"));

    expect(parseResetTime("resets 3:45 PM")?.getDate()).toBe(5);
  });

  it("zeroes seconds and milliseconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T09:00:30.500"));

    const reset = parseResetTime("resets 3:45 PM");

    expect(reset?.getSeconds()).toBe(0);
    expect(reset?.getMilliseconds()).toBe(0);
  });
});
