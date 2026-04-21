import fs from "node:fs";
import path from "node:path";
import { serve } from "bun";
import { BotError } from "./BotError";
import bot from "./bot";
import { getPrettyVersion } from "./botVersion";
import config from "./config";
import { start } from "./main";
import { migrateAllUp } from "./migrate";
import { PluginInstallationError } from "./PluginInstallationError";
import web from "./web";
import logger from "./logger";

const bunVersion = process.versions.bun.split(".").map(parseInt) as [
  number,
  number,
  number,
];

if (bunVersion[0] < 1 || bunVersion[1] < 3) {
  console.error("Unsupported Bun version! Please install Bun 1.3.0+");
  process.exit(1);
}

const djsVersion = (() => {
  const proc = Bun.spawnSync(["bun", "pm", "ls"], { stdout: "pipe" });
  const output = proc.stdout.toString();
  const match = output.match(new RegExp(`discord\.js@([\\d.]+)`));

  return match && match[1] ? match[1] : "unknown";
})();

// Print out bot and Bun version
console.log(
  `Starting Modmail ${getPrettyVersion()} on Bun ${process.versions.bun} (${process.arch}) with Discord.js version ${djsVersion}`,
);

// Verify node modules have been installed

try {
  fs.accessSync(path.join(__dirname, "..", "node_modules"));
} catch (_e) {
  console.error(
    'Please run "bun install --frozen-lockfile" before starting the bot',
  );
  process.exit(1);
}

// Error handling
// Force crash on unhandled rejections and uncaught exceptions.
// Use something like forever/pm2 to restart.
const MAX_STACK_TRACE_LINES =
  process.env.NODE_ENV === "development" ? Infinity : 8;

function errorHandler(err: Error & { code?: string }) {
  // Unknown message types (nitro boosting messages at the time) should be safe to ignore
  if (err?.message?.startsWith("Unhandled MESSAGE_CREATE type")) {
    return;
  }

  if (!err) {
    console.error("a fatal and very strange error has occurred...");
    return process.exit(1);
  }

  if (err instanceof BotError) {
    // Leave out stack traces for BotErrors (the message has enough info)
    // console.error(`Error: ${err.message}`);
  } else if (err.message === "Disallowed intents specified") {
    let fullMessage = "Error: Disallowed intents specified";
    fullMessage += "\n\n";
    fullMessage +=
      "To run the bot, you must enable 'Server Members Intent' on your bot's page in the Discord Developer Portal:";
    fullMessage += "\n\n";
    fullMessage += "1. Go to https://discord.com/developers/applications";
    fullMessage += "2. Click on your bot";
    fullMessage += "3. Click 'Bot' on the sidebar";
    fullMessage += "4. Turn on 'Server Members Intent'";

    console.error(fullMessage);
  } else if (err instanceof PluginInstallationError) {
    // Don't truncate PluginInstallationErrors as they can get lengthy
    console.error(err);
  } else {
    // Truncate long stack traces for other errors
    const stack = err.stack || "";
    let stackLines = stack.split("\n");
    if (stackLines.length > MAX_STACK_TRACE_LINES + 2) {
      stackLines = stackLines.slice(0, MAX_STACK_TRACE_LINES);
      stackLines.push(
        `    ...stack trace truncated to ${MAX_STACK_TRACE_LINES} lines`,
      );
    }
    const finalStack = stackLines.join("\n");

    if (err.code) {
      console.error(`Error ${err.code}: ${finalStack}`);
    } else {
      console.error(`An error has occurred:`);
      console.error(err);
    }
  }
}

process.on("uncaughtException", errorHandler);
process.on("unhandledRejection", errorHandler);

const packageJson = await Bun.file("./package.json").json();
const modules = Object.keys(packageJson.dependencies);
modules.forEach((mod) => {
  try {
    fs.accessSync(path.join(__dirname, "..", "node_modules", mod));
  } catch (_e) {
    console.error(
      `Please run "bun install --frozen-lockfile" again! Package "${mod}" is missing.`,
    );
    process.exit(1);
  }
});

/*
 * DEBUG: Override the global fetch object
 **/
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (
    url: Parameters<typeof fetch>[0],
    options?: Parameters<typeof fetch>[1],
  ) => {
    if (url.toString().includes("discord") && options?.body) {
      console.log("[Discord Request]", url);
      try {
        console.log(JSON.parse(options.body as string));
      } catch {
        console.log(options.body);
      }
    }
    return originalFetch(url, options as RequestInit);
  },
  originalFetch,
);

(async () => {
  await migrateAllUp();

  logger.info(`Pino opened on level ${process.env.PINO_LOG_LEVEL}`);

  // Start the bot
  start(bot);

  // Run the webserver
  serve({
    fetch: web.fetch,
    port: config.web.port,
  });
})();
