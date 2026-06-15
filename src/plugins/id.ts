import type { ModuleProps } from "../plugins";
import type { Thread } from "../repositories/threads";
import {
  findThreadMessageByMessageNumber,
  getDMChannel,
  postSystemMessage,
} from "../thread";
import * as utils from "../utils";

export default ({ db, commands }: ModuleProps) => {
  commands.addInboxThreadCommand(
    "id",
    [],
    async (_msg, _args, thread: Thread) => {
      postSystemMessage(db, thread, thread.user_id);
    },
    { allowSuspended: true },
  );

  commands.addInboxThreadCommand(
    "dm_channel_id",
    [],
    async (_msg, _args, thread: Thread) => {
      const dmChannel = await getDMChannel(thread);
      postSystemMessage(db, thread, dmChannel.id);
    },
    { allowSuspended: true },
  );

  commands.addInboxThreadCommand(
    "message",
    "<messageNumber:number>",
    async (_msg, args, thread: Thread) => {
      if (!thread) return;
      const threadMessage = await findThreadMessageByMessageNumber(
        db,
        thread,
        args.messageNumber as number,
      );
      if (!threadMessage) {
        postSystemMessage(
          db,
          thread,
          "No message in this thread with that number",
        );
        return;
      }

      const channelId = threadMessage.dm_channel_id;

      // In specific rare cases, such as createThreadOnMention, a thread message may originate from a main server
      const channelIdServer = utils
        .getMainGuilds()
        .find((g) => g.channels.fetch(channelId));

      const messageLink = channelIdServer
        ? `https://discord.com/channels/${channelIdServer.id}/${channelId}/${threadMessage.dm_message_id}`
        : `https://discord.com/channels/@me/${channelId}/${threadMessage.dm_message_id}`;

      const parts = [
        `Details for message \`${threadMessage.message_number}\`:`,
        `Channel ID: \`${channelId}\``,
        `Message ID: \`${threadMessage.dm_message_id}\``,
        `Link: <${messageLink}>`,
      ];

      postSystemMessage(db, thread, parts.join("\n"));
    },
    { allowSuspended: true },
  );
};
