import { describe, expect, test } from "bun:test";

import { parseEnvFile, parseResources, parseRunAfter, parseVolumeShorthand } from "../src/lib/parse.js";

describe("parseEnvFile", () => {
  test("parses KEY=VALUE lines", () => {
    expect(parseEnvFile("A=1\nB=hello\n")).toEqual({ A: "1", B: "hello" });
  });

  test("ignores blank lines and # comments, trims whitespace", () => {
    expect(parseEnvFile("\n  # comment\n  KEY = value  \n\n")).toEqual({ KEY: "value" });
  });

  test("strips matching surrounding quotes", () => {
    expect(parseEnvFile('A="quoted value"\nB=' + "'single'\nC=noquotes\n")).toEqual({
      A: "quoted value",
      B: "single",
      C: "noquotes",
    });
  });

  test("keeps = inside values", () => {
    expect(parseEnvFile("URL=https://x/?a=1")).toEqual({ URL: "https://x/?a=1" });
  });

  test("rejects lines without =", () => {
    expect(() => parseEnvFile("NOTAKEYVALUE")).toThrow("expected KEY=VALUE");
  });
});

describe("parseResources", () => {
  test("parses cpu and memory", () => {
    expect(parseResources("cpu=4,memory=16Gi")).toEqual({ cpu: 4, memory: "16Gi" });
  });

  test("gpu VRAM shorthand becomes {vram}", () => {
    expect(parseResources("cpu=4,memory=16Gi,gpu=24Gi")).toEqual({
      cpu: 4,
      memory: "16Gi",
      gpu: { vram: "24Gi" },
    });
  });

  test("gpu.model + gpu.count merge into the nested form", () => {
    expect(parseResources("gpu.model=A100,gpu.count=2")).toEqual({ gpu: { model: "A100", count: 2 } });
  });

  test("gpu.vram is equivalent to gpu=", () => {
    expect(parseResources("gpu.vram=512Mi")).toEqual({ gpu: { vram: "512Mi" } });
  });

  test("gpu.count without gpu.model throws", () => {
    expect(() => parseResources("gpu.count=2")).toThrow("gpu.count requires gpu.model");
  });

  test("unknown keys throw (never silently dropped)", () => {
    expect(() => parseResources("cpu=4,tpu=8")).toThrow("Unknown --resources key 'tpu'");
  });

  test("duplicate keys throw", () => {
    expect(() => parseResources("cpu=4,cpu=8")).toThrow("Duplicate");
  });

  test("non-numeric cpu throws", () => {
    expect(() => parseResources("cpu=many")).toThrow("cpu");
  });
});

describe("parseVolumeShorthand", () => {
  test("plain bucket:mountPath", () => {
    expect(parseVolumeShorthand("my-ml-datasets:/mnt/r2")).toEqual({
      bucket: "my-ml-datasets",
      mountPath: "/mnt/r2",
    });
  });

  test("bucket/prefix:mountPath splits on the first slash", () => {
    expect(parseVolumeShorthand("my-ml-datasets/some/prefix:/mnt/r2")).toEqual({
      bucket: "my-ml-datasets",
      prefix: "some/prefix",
      mountPath: "/mnt/r2",
    });
  });

  test("missing mountPath throws", () => {
    expect(() => parseVolumeShorthand("bucket")).toThrow("expected <bucket>[/<prefix>]:<mountPath>");
  });

  test("empty prefix throws", () => {
    expect(() => parseVolumeShorthand("bucket/:/mnt")).toThrow("expected <bucket>[/<prefix>]:<mountPath>");
  });
});

describe("parseRunAfter (Change 090)", () => {
  test("accepts a UTC instant (Z)", () => {
    expect(parseRunAfter("2026-11-25T02:00:00Z")).toBe("2026-11-25T02:00:00Z");
  });

  test("accepts ±HH:MM offsets", () => {
    expect(parseRunAfter("2026-11-25T11:00:00+09:00")).toBe("2026-11-25T11:00:00+09:00");
    expect(parseRunAfter("2026-11-25T02:00:00-05:00")).toBe("2026-11-25T02:00:00-05:00");
  });

  test("accepts compact ±HHMM and hour-only offsets", () => {
    expect(parseRunAfter("2026-11-25T11:00:00+0930")).toBe("2026-11-25T11:00:00+0930");
    expect(parseRunAfter("2026-11-25T11:00:00+09")).toBe("2026-11-25T11:00:00+09");
  });

  test("accepts fractional seconds, lowercase t/z, and space separator", () => {
    expect(parseRunAfter("2026-11-25T02:00:00.123456Z")).toBe("2026-11-25T02:00:00.123456Z");
    expect(parseRunAfter("2026-11-25t02:00:00z")).toBe("2026-11-25t02:00:00z");
    expect(parseRunAfter("2026-11-25 02:00:00Z")).toBe("2026-11-25 02:00:00Z");
  });

  test("accepts past instants (API treats them as start-now)", () => {
    expect(parseRunAfter("2020-01-01T00:00:00Z")).toBe("2020-01-01T00:00:00Z");
  });

  test("rejects naive datetimes with a timezone-specific error", () => {
    expect(() => parseRunAfter("2026-11-25T02:00:00")).toThrow("naive datetime without a timezone");
    expect(() => parseRunAfter("2026-11-25 02:00:00")).toThrow("naive datetime without a timezone");
  });

  test("rejects garbage", () => {
    expect(() => parseRunAfter("tomorrow")).toThrow("expected an RFC 3339 / ISO 8601 datetime with timezone");
    expect(() => parseRunAfter("2026-11-25")).toThrow("expected an RFC 3339 / ISO 8601 datetime with timezone");
  });

  test("rejects impossible calendar datetimes (no silent JS rollover)", () => {
    expect(() => parseRunAfter("2026-02-30T00:00:00Z")).toThrow("not a real calendar datetime");
    expect(() => parseRunAfter("2026-11-25T25:00:00Z")).toThrow("not a real calendar datetime");
    expect(() => parseRunAfter("2026-13-01T00:00:00Z")).toThrow("not a real calendar datetime");
  });

  test("rejects out-of-range offsets", () => {
    expect(() => parseRunAfter("2026-11-25T02:00:00+99:00")).toThrow("not a real calendar datetime");
    // Fraction group + offset: the offset range must still be checked.
    expect(() => parseRunAfter("2026-11-25T02:00:00.5+99:99")).toThrow("not a real calendar datetime");
  });

  test("trims surrounding whitespace", () => {
    expect(parseRunAfter("  2026-11-25T02:00:00Z  ")).toBe("2026-11-25T02:00:00Z");
  });
});
