import { createNewThreadForUser, type Thread } from "../data/Thread";
import type { ModuleProps } from "../plugins";
import { threadCreationQueue } from "../queue";
import { findOpenThreadByUserID } from "../repositories/threads";
import { postSystemMessage } from "../thread";
import { postSystemMessageWithFallback } from "../utils";

export default ({ bot, db, config, commands }: ModuleProps) => {
  commands.addInboxServerCommand(
    "newthread",
    "<userId:userId>",
    async (msg, args, thread) => {
      if (!msg.channel.isSendable()) return;

      const user = await bot.users.fetch(args.userId as string);
      if (!user) {
        postSystemMessageWithFallback(msg.channel, null, "User not found!");
        return;
      }

      if (user.bot) {
        postSystemMessageWithFallback(
          msg.channel,
          thread,
          "Can't create a thread for a bot",
        );
        return;
      }

      const existingThread = (
        await findOpenThreadByUserID(db, user.id)
      )[0] as Thread;

      if (existingThread) {
        postSystemMessageWithFallback(
          msg.channel,
          thread,
          `Cannot create a new thread; there is another open thread with this user: <#${existingThread.channel_id}>`,
        );
        return;
      }

      const createdThread = await createNewThreadForUser(
        db,
        threadCreationQueue,
        user,
        {
          quiet: true,
          ignoreRequirements: true,
          ignoreHooks: true,
          source: "command",
        },
      );

      if (createdThread) {
        msg.channel.send(`Thread opened: <#${createdThread.channel_id}>`);
        postSystemMessage(
          db,
          createdThread,
          `Thread was opened by ${msg.member?.nickname || config.useDisplaynames ? msg.author.globalName || msg.author.username : msg.author.username}`,
        );
      }
    },
  );
};
