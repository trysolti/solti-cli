/**
 * Pure parsers for `solti job run` flag payloads (constitution tools/cli.md
 * §2.2). Kept free of I/O so they can be unit-tested directly (tests/parse.test.ts).
 */

/** Normalizes repeatable + comma-separated flag values (cli.md §2.2:
 * `--cloud aws,gcp` and `--cloud aws --cloud gcp` are both valid). Returns a
 * flat, trimmed, empty-item-free array so the API always receives a JSON
 * array — a scalar `cloud`/`region` payload is what poisoned jobs.cloud on
 * the live API (Change 048). */
export function parseStringList(values: string[] | string | undefined): string[] {
  const list = values === undefined ? [] : Array.isArray(values) ? values : [values];
  return list
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/** Parses `.env`-style content: KEY=VALUE lines; blank lines and `#`
 * comments are ignored; whitespace is trimmed; matching surrounding quotes
 * are stripped from values. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid env line '${line}' — expected KEY=VALUE`);
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export interface ParsedResources {
  cpu?: number;
  memory?: string;
  /** Nested GPU request form validated by solti-api `_validate_gpu_resources`:
   * VRAM shorthand `gpu=24Gi` → `{vram}`; `gpu.model`/`gpu.count` hard
   * constraints merge into the same object (`count` requires `model`). */
  gpu?: { vram?: string; model?: string; count?: number };
  /** Boot/root disk override (Change 100): whole GiB integer or Gi/Mi quantity
   * string, 10–16384 GiB; omitted = per-provider image default. */
  storage?: number | string;
}

const VRAM_RE = /^\d+(\.\d+)?(Gi|Mi)?$/;

/** Matches an RFC 3339 / ISO 8601 datetime that carries an explicit UTC
 * offset: `Z`/`z`, `±HH:MM`, `±HHMM`, or `±HH`; `T`/`t`/space separator;
 * optional fractional seconds. Naive datetimes (no offset) never match —
 * the API rejects them with 422 (Change 090), so the CLI must too. */
const RUN_AFTER_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:[Zz]|([+-])(\d{2}):?(\d{2})?)$/;

const NAIVE_RUN_AFTER_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Validates a `--run-after` value (Change 090): a parseable, timezone-aware
 * RFC 3339 / ISO 8601 datetime. Garbage and naive datetimes (no offset) throw
 * with a clear message — no server-local-time guessing. Past instants are
 * allowed (the API treats them as "start now"). Returns the trimmed value for
 * the `runAfter` payload field verbatim; the API normalizes it to UTC. */
export function parseRunAfter(value: string): string {
  const datetime = value.trim();
  if (NAIVE_RUN_AFTER_RE.test(datetime)) {
    throw new Error(
      `Invalid --run-after '${value}' — naive datetime without a timezone; append an offset (Z or ±HH:MM), e.g. 2026-11-25T02:00:00Z`,
    );
  }
  const match = RUN_AFTER_RE.exec(datetime);
  if (!match) {
    throw new Error(
      `Invalid --run-after '${value}' — expected an RFC 3339 / ISO 8601 datetime with timezone, e.g. 2026-11-25T02:00:00Z or 2026-11-25T11:00:00+09:00`,
    );
  }
  // Round-trip the calendar components through Date.UTC: impossible dates
  // (2026-02-30) or out-of-range times (25:00) silently roll over in JS, so
  // a mismatch means the value is not a real datetime. Date.UTC ignores the
  // offset entirely, so the offset groups are range-checked separately.
  const [, year, month, day, hour, minute, second, , offsetSign, offsetHours, offsetMinutes] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
  );
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second) ||
    (offsetSign !== undefined && (Number(offsetHours) > 23 || Number(offsetMinutes ?? "0") > 59))
  ) {
    throw new Error(`Invalid --run-after '${value}' — not a real calendar datetime`);
  }
  return datetime;
}

/** Boot-disk override value (Change 100): a bare integer is a whole number of
 * GiB (sent as a JSON number); a Gi/Mi quantity string (case-insensitive
 * suffix) passes through verbatim like memory, with the API normalizing the
 * suffix case. Fractional results (e.g. 10.5Gi, 10241Mi) are rejected — disk
 * sizes are integral. Bounds 10..16384 GiB are checked client-side for fast
 * feedback; the API re-validates. */
const STORAGE_QTY_RE = /^(\d+)(Gi|Mi)?$/i;

function parseStorage(value: string): number | string {
  const match = STORAGE_QTY_RE.exec(value);
  if (!match) {
    throw new Error(
      `Invalid --resources storage '${value}' — expected a whole GiB integer or a quantity like 100Gi / 102400Mi (10–16384 GiB)`,
    );
  }
  if (match[2] === undefined || match[2].toLowerCase() === "gi") {
    const gib = Number(match[1]);
    if (gib < 10 || gib > 16384) {
      throw new Error(`Invalid --resources storage '${value}' — ${gib} GiB out of bounds (10–16384)`);
    }
    // A bare integer is sent as a JSON number; a Gi-suffixed quantity passes
    // through verbatim like memory (the API normalizes the suffix case).
    return match[2] === undefined ? gib : value;
  }
  const rawMi = Number(match[1]);
  if (rawMi % 1024 !== 0) {
    throw new Error(
      `Invalid --resources storage '${value}' — ${rawMi} Mi is not a whole number of GiB; disk sizes are integral`,
    );
  }
  const gib = rawMi / 1024;
  if (gib < 10 || gib > 16384) {
    throw new Error(`Invalid --resources storage '${value}' — ${gib} GiB out of bounds (10–16384)`);
  }
  return value;
}

/** Parses a `--resources` spec, e.g. `cpu=4,memory=16Gi,storage=100Gi,gpu=24Gi`
 * or `cpu=4,memory=16Gi,gpu.model=A100,gpu.count=2`. Unknown keys, duplicates
 * of the same key, non-numeric cpu/count values, invalid storage values, and
 * `gpu.count` without `gpu.model` throw — nothing is silently dropped. */
export function parseResources(spec: string): ParsedResources {
  const resources: ParsedResources = {};
  const gpu: NonNullable<ParsedResources["gpu"]> = {};
  let gpuSeen = false;
  const seen = new Set<string>();

  for (const rawPair of spec.split(",")) {
    const pair = rawPair.trim();
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --resources entry '${pair}' — expected key=value (e.g. cpu=4,memory=16Gi,gpu=24Gi)`);
    }
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (seen.has(key)) {
      throw new Error(`Duplicate --resources key '${key}'`);
    }
    seen.add(key);

    switch (key) {
      case "cpu": {
        const cpu = Number(value);
        if (!Number.isFinite(cpu) || cpu <= 0) {
          throw new Error(`Invalid --resources cpu value '${value}' — expected a positive number`);
        }
        resources.cpu = cpu;
        break;
      }
      case "memory":
        if (value === "") throw new Error("Invalid --resources memory value — expected e.g. memory=16Gi");
        resources.memory = value;
        break;
      case "storage":
        resources.storage = parseStorage(value);
        break;
      case "gpu":
      case "gpu.vram": {
        if (!VRAM_RE.test(value)) {
          throw new Error(`Invalid --resources GPU VRAM '${value}' — expected a quantity like 24Gi (or gpu.model=A100)`);
        }
        gpu.vram = value;
        gpuSeen = true;
        break;
      }
      case "gpu.model":
        if (value === "") throw new Error("Invalid --resources gpu.model value — expected e.g. gpu.model=A100");
        gpu.model = value;
        gpuSeen = true;
        break;
      case "gpu.count": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) {
          throw new Error(`Invalid --resources gpu.count '${value}' — expected a positive integer`);
        }
        gpu.count = count;
        gpuSeen = true;
        break;
      }
      default:
        throw new Error(
          `Unknown --resources key '${key}' — supported: cpu, memory, storage, gpu=<vram>, gpu.vram, gpu.model, gpu.count`,
        );
    }
  }

  if (gpuSeen) {
    if (gpu.count !== undefined && gpu.model === undefined) {
      throw new Error("--resources gpu.count requires gpu.model (e.g. gpu.model=A100,gpu.count=2)");
    }
    resources.gpu = gpu;
  }
  return resources;
}

export interface ParsedVolumeShorthand {
  bucket: string;
  /** Key prefix within the bucket (from the `<bucket>/<prefix>:<mountPath>`
   * form); undefined for plain `<bucket>:<mountPath>`. */
  prefix?: string;
  mountPath: string;
}

/** Parses the volume shorthand `<bucket>[/<prefix>]:<mountPath>` (the first
 * colon separates the bucket part from the mount path; the first slash of the
 * bucket part separates bucket from prefix). */
export function parseVolumeShorthand(spec: string): ParsedVolumeShorthand {
  const colon = spec.indexOf(":");
  if (colon === -1) {
    throw new Error(`Invalid --volume spec '${spec}' — expected <bucket>[/<prefix>]:<mountPath>`);
  }
  const bucketPart = spec.slice(0, colon);
  const mountPath = spec.slice(colon + 1);
  if (bucketPart === "" || mountPath === "") {
    throw new Error(`Invalid --volume spec '${spec}' — expected <bucket>[/<prefix>]:<mountPath>`);
  }
  const slash = bucketPart.indexOf("/");
  if (slash === -1) return { bucket: bucketPart, mountPath };
  const bucket = bucketPart.slice(0, slash);
  const prefix = bucketPart.slice(slash + 1);
  if (bucket === "" || prefix === "") {
    throw new Error(`Invalid --volume spec '${spec}' — expected <bucket>[/<prefix>]:<mountPath>`);
  }
  return { bucket, prefix, mountPath };
}
