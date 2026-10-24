export interface Config {
  telegramToken: string;
  allowedChatId: number;
  remarkableFolder: string;
  rmapiBin: string;
  rmapiConfig: string | undefined;
  maxDownloadBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const telegramToken = required(env, "TELEGRAM_BOT_TOKEN");
  // Fail closed: without an allowed chat the bot would accept uploads from anyone.
  const rawChatId = required(env, "ALLOWED_CHAT_ID");
  const allowedChatId = Number(rawChatId);
  if (!Number.isSafeInteger(allowedChatId)) {
    throw new Error(`ALLOWED_CHAT_ID must be an integer, got "${rawChatId}"`);
  }

  return {
    telegramToken,
    allowedChatId,
    remarkableFolder: normalizeFolder(env.REMARKABLE_FOLDER ?? "/Inbox"),
    rmapiBin: env.RMAPI_BIN ?? "rmapi",
    rmapiConfig: env.RMAPI_CONFIG || undefined,
    maxDownloadBytes: Number(env.MAX_DOWNLOAD_MB ?? 50) * 1024 * 1024,
  };
}

export function normalizeFolder(folder: string): string {
  const trimmed = folder.trim().replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed || "/" : `/${trimmed}`;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}
