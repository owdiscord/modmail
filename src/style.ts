import type { ColorResolvable } from "discord.js";

export const Emoji = {
	CheckBadge: "<:Official:944773335882031175>",
	Megaphone: "📣",
	Alert: "<:Alert:1466320245810663528>",
	Muted: "<:Muted:1466317143531327683>",
	Discord: "<:Discord:1466325410080886844>",
	Overwatch: "<:Overwatch:1466317117476573288>",
	Banned: "<:Banned:1049947904833507368>",
	Docs: "<:Docs:1172077218260848690>",
	Verified: "<:Verified:1466317991183515802>",
	Modmail: "<:ModMail:1466317685926269043>",
	Appeals: "<:Appeals:1466328093466562808>",
	Schedule: "🕙",
	Notepad: "🗒️",
	Volume: "🔊",
	Roles: {
		LFGTool: "<:LFGTool:1466324267279847454>",
		Grey: "<:RoleGrey:1466333333196771408>",
		VishkarBlue: "<:VishkarBlue:1466333344894554213>",
		OladeleGreen: "<:OladeleGreen:1466333343644647569>",
		GuilliardPurple: "<:GuillardPurple:1466333345888735233>",
		HelixYellow: "<:HelixYellow:1466333349433053339>",
		KamoriTeal: "<:KamoriTeal:1466333334190690384>",
		Omnic: "<:Omnic:1466317957503389798>",
		Coach: "<:Coach:1466317887362039972>",
		CoachTrainee: "<:CoachTrainee:1466317873395007722>",
		Blizzard: "<:Blizzard:1466317831858688030>",
		Admin: "<:Admin:1466317744168239400>",
		Moderator: "<:Moderator:1466317729442037893>",
		Trainee: "<:Trainee:1466317717597458512>",
		Distinguished: "<:Distinguished:1466317772513480839>",
		NitroBooster: "<:NitroBooster:1466333347121991745>",
		FaceIt: "<:FACEIT:1466322454925410318>",
		Decennial: "<:Decennial:1466333348229025852>",
		Quinquennial: "<:Quinquennial:1466333331195953335>",
		EventWinner: "<:EventWinner:1466319423815159808>",
		EventHost: "<:EventHost:1466333335579004980>",
	},
};

export const Colours: Record<string, ColorResolvable> = {
	Red: "#DA3E44",
	BanRed: "#ED4446",
	MuteRed: "#E64E3D",
	Orange: "#F06414",
};

const roleEmojis = {
	Admin: Emoji.Roles.Admin,
	Moderator: Emoji.Roles.Moderator,
	Trainee: Emoji.Roles.Trainee,
	Blizzard: Emoji.Overwatch,
	"Subreddit Mod": Emoji.Roles.Moderator,
	"Event Winner": Emoji.Roles.EventWinner,
	"Helix Yellow": Emoji.Roles.HelixYellow,
	"Guillard Purple": Emoji.Roles.GuilliardPurple,
	"Oladele Green": Emoji.Roles.OladeleGreen,
	"Kamori Teal": Emoji.Roles.KamoriTeal,
	"Vishkar Blue": Emoji.Roles.VishkarBlue,
	Distinguished: Emoji.Roles.Distinguished,
	Accomplished: Emoji.Roles.Grey,
	Regular: Emoji.Roles.Grey,
	Verified: Emoji.Verified,
	FACEIT: Emoji.Roles.FaceIt,
	"LFG Tool Dev": Emoji.Roles.LFGTool,
	"Head Coach": Emoji.Roles.Coach,
	Coach: Emoji.Roles.Coach,
	"Coach Trainee": Emoji.Roles.CoachTrainee,
	Decennial: Emoji.Roles.Decennial,
	Quinquennial: Emoji.Roles.Quinquennial,
	Veteran: Emoji.Roles.Grey,
	"Nitro Booster": Emoji.Roles.NitroBooster,
};

const roleMap = {
	Admin: "Admin",
	Moderator: "Moderator",
	Trainee: "Trainee",
	Blizzard: "Blizzard",
	"Subreddit Mod": "Subreddit Mod",
	Distinguished: "Distinguished",
	Accomplished: "Accomplished",
	"Event Winner": "Event Winner",
	"Guillard Purple": "Guillard Purple",
	"Vishkar Blue": "Vishkar Blue",
	"Kamori Teal": "Kamori Teal",
	"Oladele Green": "Oladele Green",
	"Helix Yellow": "Helix Yellow",
	Regular: "Regular",
	Verified: "Verified",
	FACEIT: "FACEIT",
	"LFG Tool Dev": "LFG Tool Dev",
	"Esports Org": "Esports Org",
	"Event Host": "Event Host",
	"Head Coach": "Head Coach",
	Coach: "Coach",
	"Coach Trainee": "Coach Trainee",
	Decennial: "Decennial",
	Quinquennial: "Quinquennial",
	"Nitro Booster": "Nitro Booster",
	Veteran: "Veteran",
	"Esports Announcement Coordinator": "Esports Announcement Coordinator",
	"Server Events Mute": "Server Events Mute",
	"📢 Overwatch Announcements": "Overwatch Announcements",
	"📢 Server Announcements": "Server Announcements",
	"📢 Server Events": "Server Events",
	"📢 PC Tournaments": "PC Tournaments",
	"📢 Console Tournaments": "Console Tournaments",
	"🎁 Giveaways": "Giveaways",
	"🔓 LFG (PC-NA)": "LFG (PC-NA)",
	"🔓 LFG (PC-EU)": "LFG (PC-EU)",
	"🔓 LFG (PC-OCE/AS)": "LFG (PC-OCE/AS)",
	"🔓 LFG (Console)": "LFG (Console)",
	"🔓 Team Recruitment (NA)": "Team Recruitment (NA)",
	"🔓 Team Recruitment (EU)": "Team Recruitment (EU)",
	"🔓 Coaching & Advice": "Coaching & Advice",
};

export function localRole(roleName: string): string | null {
	if (Object.hasOwn(roleMap, roleName))
		// @ts-expect-error We are checking this
		return roleMap[roleName];

	return null;
}

export function roleEmoji(roleName: string) {
	if (Object.hasOwn(roleEmojis, roleName))
		// @ts-expect-error We are checking this
		return roleEmojis[roleName];

	return Emoji.Roles.Grey;
}

export function sortRoles(roles: Array<string>): Array<string> {
	const objValues = [
		"Admin",
		"Moderator",
		"Trainee",
		"Blizzard",
		"Subreddit Mod",
		"Distinguished",
		"Accomplished",
		"Event Winner",
		"Verified",
		"FACEIT",
		"LFG Tool Dev",
		"Esports Org",
		"Event Host",
		"Head Coach",
		"Coach",
		"Coach Trainee",
		"Guillard Purple",
		"Vishkar Blue",
		"Kamori Teal",
		"Oladele Green",
		"Helix Yellow",
		"Decennial",
		"Quinquennial",
		"Nitro Booster",
		"Veteran",
		"Regular",
		"Esports Announcement Coordinator",
		"Server Events Mute",
		"Overwatch Announcements",
		"Server Announcements",
		"Server Events",
		"PC Tournaments",
		"Console Tournaments",
		"Giveaways",
		"LFG (PC-NA)",
		"LFG (PC-EU)",
		"LFG (PC-OCE/AS)",
		"LFG (Console)",
		"Team Recruitment (NA)",
		"Team Recruitment (EU)",
		"Coaching & Advice",
	];

	return roles.sort((a, b) => objValues.indexOf(a) - objValues.indexOf(b));
}

export const Spacing = {
	Doublespace: " ",
	DraysPrecious: "  ",
};

// That's on periodt. I'm dead as a chile
export const UnicodePeriod = "․";
