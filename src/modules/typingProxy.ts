import { ChannelType, Events, GuildChannel } from "discord.js";
import { findByChannelId, findOpenThreadByUserId } from "../data/threads";
import type { ModuleProps } from "../plugins";
import { noop } from "../utils";

export default ({ bot, db, config }: ModuleProps) => {
	if (config.typingProxy || config.typingProxyReverse) {
		bot.on(Events.TypingStart, async ({ channel, user }) => {
			if (!user) return;

			// config.typingProxy: forward user typing in a DM to the modmail thread
			if (config.typingProxy && !(channel instanceof GuildChannel)) {
				const thread = await findOpenThreadByUserId(db, user.id);
				if (!thread) return;

				const threadChannel = await bot.channels.fetch(thread.channel_id);

				if (threadChannel?.isSendable())
					await threadChannel.sendTyping().catch(noop);
				return;
			}

			// config.typingProxyReverse: forward moderator typing in a thread to the DM
			if (
				config.typingProxyReverse &&
				channel.type === ChannelType.GuildText &&
				!user.bot
			) {
				const thread = await findByChannelId(db, channel.id);
				if (!thread) return;

				const dmChannel = await thread.getDMChannel();
				if (!dmChannel) return;

				dmChannel.sendTyping().catch(noop);
			}
		});
	}
};
