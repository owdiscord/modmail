import { ChannelType, Events, GuildChannel } from "discord.js";
import type { Thread } from "../data/Thread";
import type { ModuleProps } from "../plugins";
import * as threads from "../repositories/threads";
import { noop } from "../utils";
import { getDMChannel } from "../thread";

export default ({ bot, db, config }: ModuleProps) => {
  if (config.typingProxyToInbox || config.typingProxyToUser) {
    bot.on(Events.TypingStart, async ({ channel, user }) => {
      if (!user) return;

      // config.typingProxy: forward user typing in a DM to the modmail thread
      if (config.typingProxyToInbox && !(channel instanceof GuildChannel)) {
        const threadRow = await threads.findOpenThreadByUserID(db, user.id);
        if (!threadRow?.[0]) return;

        const thread = threadRow[0] as Thread;
        const threadChannel = await bot.channels.fetch(thread.channel_id);

        if (threadChannel?.isSendable())
          await threadChannel.sendTyping().catch(noop);
        return;
      }

      // config.typingProxyReverse: forward moderator typing in a thread to the DM
      if (
        config.typingProxyToUser &&
        channel.type === ChannelType.GuildText &&
        !user.bot
      ) {
        const threadRow = await threads.findByChannelID(db, channel.id);
        if (!threadRow?.[0]) return;

        const thread = threadRow[0] as Thread;

        const dmChannel = await getDMChannel(thread);
        if (!dmChannel) return;

        dmChannel.sendTyping().catch(noop);
      }
    });
  }
};
