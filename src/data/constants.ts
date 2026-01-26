export const ThreadStatus = {
	Open: 1,
	Closed: 2,
	Suspended: 3,
};

export enum ThreadMessageType {
	System = 1,
	Chat = 2,
	FromUser = 3,
	ToUser = 4,
	Legacy = 5,
	Command = 6,
	SystemToUser = 7,
	ReplyEdited = 8,
	ReplyDeleted = 9,
}

// https://discord.com/developers/docs/resources/channel#channel-object-channel-types
export const DISCORD_CHANNEL_TYPES = {
	GUILD_TEXT: 0,
	DM: 1,
	GUILD_VOICE: 2,
	GROUP_DM: 3,
	GUILD_CATEGORY: 4,
	GUILD_NEWS: 5,
	GUILD_STORE: 6,
};

// https://discord.com/developers/docs/resources/channel#message-object-message-activity-types
export const DISCORD_MESSAGE_ACTIVITY_TYPES = {
	JOIN: 1,
	SPECTATE: 2,
	LISTEN: 3,
	JOIN_REQUEST: 5,
};

export const ACCIDENTAL_THREAD_MESSAGES = [
	"ok",
	"okay",
	"thanks",
	"ty",
	"k",
	"kk",
	"thank you",
	"thanx",
	"thnx",
	"thx",
	"tnx",
	"ok thank you",
	"ok thanks",
	"ok ty",
	"ok thanx",
	"ok thnx",
	"ok thx",
	"ok no problem",
	"ok np",
	"okay thank you",
	"okay thanks",
	"okay ty",
	"okay thanx",
	"okay thnx",
	"okay thx",
	"okay no problem",
	"okay np",
	"okey thank you",
	"okey thanks",
	"okey ty",
	"okey thanx",
	"okey thnx",
	"okey thx",
	"okey no problem",
	"okey np",
	"cheers",
];
