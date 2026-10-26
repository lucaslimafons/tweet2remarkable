import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareRmapiConfig } from "../src/env.ts";

const CONF = "devicetoken: abc\nusertoken: def\n";
const dir = () => mkdtempSync(join(tmpdir(), "t2rm-env-"));

describe("prepareRmapiConfig", () => {
  it("writes RMAPI_CONFIG_B64 to a private temp file", () => {
    const out = dir();
    const path = prepareRmapiConfig({ RMAPI_CONFIG_B64: Buffer.from(CONF).toString("base64") }, out);
    expect(path).toBe(join(out, "rmapi.conf"));
    expect(readFileSync(path!, "utf8")).toBe(CONF);
    expect(statSync(path!).mode & 0o777).toBe(0o600);
  });

  it("rejects a value that isn't an rmapi config", () => {
    expect(() => prepareRmapiConfig({ RMAPI_CONFIG_B64: Buffer.from("hello").toString("base64") }, dir())).toThrow(
      "doesn't look like an rmapi config",
    );
  });

  it("uses a writable RMAPI_CONFIG as is, and copies a read-only one", () => {
    const src = dir();
    const file = join(src, "rmapi.conf");
    writeFileSync(file, CONF);
    expect(prepareRmapiConfig({ RMAPI_CONFIG: file }, dir())).toBe(file);

    chmodSync(file, 0o444);
    const out = dir();
    const copy = prepareRmapiConfig({ RMAPI_CONFIG: file }, out);
    expect(copy).toBe(join(out, "rmapi.conf"));
    expect(readFileSync(copy!, "utf8")).toBe(CONF);
  });

  it("leaves rmapi's default when nothing is configured", () => {
    expect(prepareRmapiConfig({}, dir())).toBeUndefined();
  });
});
