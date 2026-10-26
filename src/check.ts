// Validates a deployment without polling (so it can run next to a live bot):
// Telegram token, rmapi binary + pairing, destination folder. `pnpm check` / `node src/check.ts`.
import { Api } from "grammy";
import { loadConfig } from "./config.ts";
import { loadDotEnv, prepareRmapiConfig } from "./env.ts";
import { errorMessage, registerSecret } from "./log.ts";
import { createRmapi } from "./remarkable/rmapi.ts";

loadDotEnv();
let ok = true;
async function step(name: string, run: () => Promise<string>): Promise<void> {
  try {
    console.log(`✓ ${name}: ${await run()}`);
  } catch (err) {
    ok = false;
    console.log(`✗ ${name}: ${errorMessage(err)}`);
  }
}

const config = loadConfig();
registerSecret(config.telegramToken);
await step("Telegram token", async () => `@${(await new Api(config.telegramToken).getMe()).username}`);
await step("allowed chat", async () => String(config.allowedChatId));
const rmapi = createRmapi({ bin: config.rmapiBin, configPath: prepareRmapiConfig() });
await step("rmapi binary", () => rmapi.version());
await step("reMarkable pairing + folder", async () => (await rmapi.mkdirp(config.remarkableFolder), config.remarkableFolder));
process.exit(ok ? 0 : 1);
