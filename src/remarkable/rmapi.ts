import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { dateSuffix } from "../filename.ts";

export interface Rmapi {
  /** Uploads a local .pdf/.epub into `folder`, creating it if needed. Returns the document name used. */
  put(filePath: string, folder: string): Promise<string>;
  mkdirp(folder: string): Promise<void>;
  version(): Promise<string>;
}

export interface RmapiOptions {
  bin: string;
  configPath?: string;
  timeoutMs?: number;
}

export class RmapiError extends Error {
  readonly output: string;
  readonly exitCode: number | null;

  constructor(message: string, output: string, exitCode: number | null) {
    super(message);
    this.name = "RmapiError";
    this.output = output;
    this.exitCode = exitCode;
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
}

const ALREADY_EXISTS = "entry already exists";
// Printed by `rmapi -ni` when there is no device token (rmapi auth.go).
const NOT_PAIRED = "missing token, not asking";
const MAX_OUTPUT = 16 * 1024;

export function createRmapi({ bin, configPath, timeoutMs = 120_000 }: RmapiOptions): Rmapi {
  const knownFolders = new Set<string>(["/"]);

  // -ni: never prompt for a one-time code; fail instead of hanging on stdin.
  function run(args: string[]): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, ["-ni", ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: configPath ? { ...process.env, RMAPI_CONFIG: configPath } : process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout = (stdout + chunk).slice(-MAX_OUTPUT)));
      child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-MAX_OUTPUT)));

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new RmapiError(`rmapi ${args[0]} timed out after ${timeoutMs / 1000}s`, stderr || stdout, null));
      }, timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new RmapiError(`could not run rmapi (${bin}): ${err.message}`, "", null));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve({ stdout, stderr });
        const output = (stderr || stdout).trim();
        const reason = output.includes(NOT_PAIRED) ? "not paired with reMarkable (run `pnpm rmapi:pair`)" : lastLine(output);
        reject(new RmapiError(`rmapi ${args[0]} failed: ${reason || `exit code ${code}`}`, output, code));
      });
    });
  }

  async function mkdirp(folder: string): Promise<void> {
    const parts = folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (knownFolders.has(current)) continue;
      // mkdir on an existing folder prints "entry already exists" and exits 0.
      await run(["mkdir", current]);
      knownFolders.add(current);
    }
  }

  async function put(filePath: string, folder: string): Promise<string> {
    await mkdirp(folder);
    const name = basename(filePath, extname(filePath));
    try {
      await run(["put", filePath, folder]);
      return name;
    } catch (err) {
      if (!(err instanceof RmapiError) || !err.output.includes(ALREADY_EXISTS)) throw err;
    }
    // rmapi names the document after the file, so re-upload a copy under a unique name.
    // (--force would replace the existing document and wipe its annotations.)
    const renamed = `${name} (${dateSuffix()})`;
    const dir = await mkdtemp(join(tmpdir(), "t2rm-"));
    try {
      const copy = join(dir, `${renamed}${extname(filePath)}`);
      await copyFile(filePath, copy);
      await run(["put", copy, folder]);
      return renamed;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function version(): Promise<string> {
    const { stdout } = await run(["version"]);
    return stdout.trim();
  }

  return { put, mkdirp, version };
}

function lastLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
}
