import { ChannelType, Events, GuildChannel } from "discord.js";
import * as threads from "../repositories/threads";
import type { ModuleProps } from "../plugins";
import { noop } from "../utils";
import Thread from "../data/Thread";

export default ({ bot, db, config }: ModuleProps) => {
  if (config.typingProxyToInbox || config.typingProxyToUser) {
    bot.on(Events.TypingStart, async ({ channel, user }) => {
      if (!user) return;

      // config.typingProxy: forward user typing in a DM to the modmail thread
      if (config.typingProxyToInbox && !(channel instanceof GuildChannel)) {
        const threadRow = await threads.findOpenThreadByUserID(db, user.id);
        if (!threadRow || !threadRow[0]) return;

        const thread = new Thread(db, threadRow[0]);
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
        if (!threadRow || !threadRow[0]) return;

        const thread = new Thread(db, threadRow[0]);

        const dmChannel = await thread.getDMChannel();
        if (!dmChannel) return;

        dmChannel.sendTyping().catch(noop);
      }
    });
  }
};
