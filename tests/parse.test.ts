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

  test("storage accepts integer GiB and Gi/Mi quantities (Change 100)", () => {
    expect(parseResources("storage=100")).toEqual({ storage: 100 });
    expect(parseResources("storage=100Gi")).toEqual({ storage: "100Gi" });
    expect(parseResources("storage=102400Mi")).toEqual({ storage: "102400Mi" });
    // Suffix case is insensitive; the API normalizes it (Change 100).
    expect(parseResources("storage=10gi")).toEqual({ storage: "10gi" });
    expect(parseResources("storage=10240mi")).toEqual({ storage: "10240mi" });
  });

  test("storage out of bounds throws (10–16384 GiB)", () => {
    expect(() => parseResources("storage=9")).toThrow("out of bounds");
    expect(() => parseResources("storage=0")).toThrow("out of bounds");
    expect(() => parseResources("storage=16385")).toThrow("out of bounds");
    expect(() => parseResources("storage=5120Mi")).toThrow("out of bounds");
  });

  test("storage fractional and malformed values throw", () => {
    expect(() => parseResources("storage=10.5Gi")).toThrow("Invalid --resources storage");
    expect(() => parseResources("storage=10241Mi")).toThrow("whole number of GiB");
    expect(() => parseResources("storage=abc")).toThrow("Invalid --resources storage");
    expect(() => parseResources("storage=-10")).toThrow("Invalid --resources storage");
  });

  test("duplicate storage key throws", () => {
    expect(() => parseResources("storage=10Gi,storage=20Gi")).toThrow("Duplicate");
  });

  test("unknown-key error lists storage among supported keys", () => {
    expect(() => parseResources("storage=100,tpu=8")).toThrow(
      "supported: cpu, memory, storage, gpu=<vram>, gpu.vram, gpu.model, gpu.count",
    );
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
