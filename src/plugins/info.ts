import {
	type DiscordAPIError,
	EmbedBuilder,
	type Guild,
	type GuildMember,
} from "discord.js";
import type { ModuleProps } from "../plugins";
import { Emoji, Spacing } from "../style";
import { getMainGuilds } from "../utils";

export default ({ commands, bot }: ModuleProps) => {
	commands.addInboxThreadCommand(
		"fakeclose",
		"",
		async (msg, _args, thread) => {
			if (!thread || !msg.channel.isSendable()) return;

			const user = await bot.users.fetch(thread.user_id);
			if (!user) return;
			const author = user;

			// author name/id
			// participant mod names
			// closing mod name
			// messages sent from user
			// messages sent to user
			// internal messages
			// loglink
			// time open

			const closeTime = new Date();
			const embed = new EmbedBuilder();
			embed.setTitle(`Closed thread with ${user.username}`);
			embed.addFields([
				{
					value: `Opened by <@${author.id}>`,
					name: `<t:${Math.round(closeTime.getTime() / 1000)}:S>`,
					inline: true,
				},
				{
					name: "Open for 11h30m",
					value: `Closed by <@${user.id}>`,
					inline: true,
				},
				{
					name: `Messages ${Emoji.Roles.LFGTool} 8${Spacing.Doublespace}•${Spacing.Doublespace}${Emoji.Roles.Moderator}4`,
					value: `<@164564849915985922> (8), <@204084691425427466> (3), and <@166767825350819840> (172)`,
				},
			]);
			embed.setTimestamp(new Date());

			thread.postSystemMessage({
				content: "",
				embeds: [embed],
			});
		},
		{},
	);
	commands.addInboxThreadCommand(
		"header",
		"",
		async (msg, _args, thread) => {
			if (!thread || !msg.channel.isSendable()) return;

			const user = await bot.users.fetch(thread.user_id);
			if (!user) return;

			// Find which main guilds this user is part of
			const mainGuilds = getMainGuilds();
			const userGuildData = new Map<
				string,
				{ guild: Guild; member: GuildMember }
			>();

			for (const guild of mainGuilds) {
				try {
					const member = await guild.members.fetch(user.id);

					if (member) {
						userGuildData.set(guild.id, { guild, member });
					}
				} catch (e: unknown) {
					// We can safely discard this error, because it just means we couldn't find the member in the guild
					// Which - for obvious reasons - is completely okay.
					if ((e as DiscordAPIError).code !== 10007) console.log(e);
				}
			}

			try {
				await thread.sendInfoHeader(user, userGuildData);
			} catch (err) {
				console.log("Could not send user header");
				console.error(err);
			}
		},
		{},
	);
};
