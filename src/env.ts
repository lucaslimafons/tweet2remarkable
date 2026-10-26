import { accessSync, constants, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Loads ./.env if present (Node's built-in parser); real env vars win. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * Returns a writable rmapi config path for hosted deployments:
 * - `RMAPI_CONFIG_B64` (the file's contents, base64) is written to a private temp file;
 * - a read-only `RMAPI_CONFIG` (e.g. a mounted secret) is copied to one, since rmapi rewrites its
 *   user token on every run (the long-lived device token never changes, so losing the copy is fine).
 */
export function prepareRmapiConfig(env: NodeJS.ProcessEnv = process.env, dir = tmpdir()): string | undefined {
  const writable = join(dir, "rmapi.conf");
  if (env.RMAPI_CONFIG_B64) {
    const content = Buffer.from(env.RMAPI_CONFIG_B64, "base64").toString("utf8");
    if (!/devicetoken/i.test(content)) throw new Error("RMAPI_CONFIG_B64 doesn't look like an rmapi config");
    writeFileSync(writable, content, { mode: 0o600 });
    return writable;
  }
  const path = env.RMAPI_CONFIG || undefined;
  if (!path || !existsSync(path)) return path;
  try {
    accessSync(path, constants.W_OK);
    return path;
  } catch {
    copyFileSync(path, writable);
    return writable;
  }
}
