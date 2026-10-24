// Minimal logging. Secrets registered here are masked in every line.
const secrets: string[] = [];

export function registerSecret(value: string): void {
  if (value) secrets.push(value);
}

export function redact(text: string): string {
  return secrets.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}

export const log = {
  info: (msg: string) => console.log(`${new Date().toISOString()} ${redact(msg)}`),
  error: (msg: string, err?: unknown) =>
    console.error(`${new Date().toISOString()} ERROR ${redact(msg)}${err ? `: ${redact(errorMessage(err))}` : ""}`),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
