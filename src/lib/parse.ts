/**
 * Pure parsers for `solti job run` flag payloads (constitution tools/cli.md
 * §2.2). Kept free of I/O so they can be unit-tested directly (tests/parse.test.ts).
 */

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
}

const VRAM_RE = /^\d+(\.\d+)?(Gi|Mi)?$/;

/** Parses a `--resources` spec, e.g. `cpu=4,memory=16Gi,gpu=24Gi` or
 * `cpu=4,memory=16Gi,gpu.model=A100,gpu.count=2`. Unknown keys, duplicates
 * of the same key, non-numeric cpu/count values, and `gpu.count` without
 * `gpu.model` throw — nothing is silently dropped. */
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
          `Unknown --resources key '${key}' — supported: cpu, memory, gpu=<vram>, gpu.vram, gpu.model, gpu.count`,
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
