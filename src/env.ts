import { existsSync } from "node:fs";

/** Loads ./.env if present (Node's built-in parser); real env vars win. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
