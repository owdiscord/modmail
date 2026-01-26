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

export default bot;
