import { Client, GatewayIntentBits, Partials } from "discord.js";

const intents = [
  // PRIVILEGED INTENTS
  GatewayIntentBits.GuildMembers,

  // REGULAR INTENTS
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageTyping,
  GatewayIntentBits.DirectMessageTyping,
  GatewayIntentBits.GuildModeration,

  // EXTRA INTENTS (from the config)
  // ...(config.extraIntents || []),
];

const bot = new Client({
  intents,
  partials: [Partials.Channel],
});

// DEBUG: Intercept REST requests to log fully
bot.rest.on("restDebug", (info) => console.log("[REST Debug]", info));
bot.rest.on("response", async (req, res) => {
  console.log("[REST Response]", req.method, req.path, res.status, res.body);
});

export default bot;
