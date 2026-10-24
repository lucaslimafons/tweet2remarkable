import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createRmapi, RmapiError } from "../src/remarkable/rmapi.ts";

const bin = join(import.meta.dirname, "fake-rmapi.sh");
let dir: string;
let logFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "t2rm-test-"));
  logFile = join(dir, "calls.log");
  process.env.FAKE_RMAPI_LOG = logFile;
  delete process.env.FAKE_RMAPI_MODE;
});

const calls = async () => (await readFile(logFile, "utf8")).trim().split("\n");

async function samplePdf(name = "paper.pdf") {
  const path = join(dir, name);
  await writeFile(path, "%PDF-1.4\n");
  return path;
}

describe("rmapi wrapper", () => {
  it("creates each folder level once, then uploads", async () => {
    const rmapi = createRmapi({ bin });
    const file = await samplePdf();
    expect(await rmapi.put(file, "/Inbox/Papers")).toBe("paper");
    await rmapi.put(file, "/Inbox/Papers");
    expect(await calls()).toEqual([
      "-ni mkdir /Inbox",
      "-ni mkdir /Inbox/Papers",
      `-ni put ${file} /Inbox/Papers`,
      `-ni put ${file} /Inbox/Papers`,
    ]);
  });

  it("re-uploads under a dated name when the title already exists", async () => {
    process.env.FAKE_RMAPI_MODE = "exists";
    const name = await createRmapi({ bin }).put(await samplePdf(), "/Inbox");
    expect(name).toMatch(/^paper \(\d{4}-\d{2}-\d{2} \d{6}\)$/);
    expect((await calls()).at(-1)).toContain(`${name}.pdf /Inbox`);
  });

  it("surfaces rmapi's error line", async () => {
    process.env.FAKE_RMAPI_MODE = "fail";
    const err = await createRmapi({ bin }).put(await samplePdf(), "/Inbox").catch((e) => e);
    expect(err).toBeInstanceOf(RmapiError);
    expect(err.message).toBe("rmapi put failed: Error:  failed to upload file [x]: 500 Internal Server Error");
  });

  it("explains how to fix a missing pairing", async () => {
    process.env.FAKE_RMAPI_MODE = "unpaired";
    const err = await createRmapi({ bin }).mkdirp("/Inbox").catch((e) => e);
    expect(err.message).toBe("rmapi mkdir failed: not paired with reMarkable (run `pnpm rmapi:pair`)");
  });

  it("kills a hung rmapi after the timeout", async () => {
    process.env.FAKE_RMAPI_MODE = "hang";
    const err = await createRmapi({ bin, timeoutMs: 200 }).mkdirp("/Inbox").catch((e) => e);
    expect(err.message).toBe("rmapi mkdir timed out after 0.2s");
  });

  it("reports a missing binary", async () => {
    const err = await createRmapi({ bin: join(dir, "nope") }).version().catch((e) => e);
    expect(err.message).toMatch(/could not run rmapi .*ENOENT/);
  });

  it("passes RMAPI_CONFIG to the child", async () => {
    const wrapper = join(dir, "env-rmapi.sh");
    await writeFile(wrapper, `#!/bin/sh\necho "$RMAPI_CONFIG"\n`, { mode: 0o755 });
    expect(await createRmapi({ bin: wrapper, configPath: "/secrets/rmapi.conf" }).version()).toBe("/secrets/rmapi.conf");
  });
});
