import type { Message } from "discord.js";
import type { Thread } from "../data/Thread";
import type { ModuleProps } from "../plugins";
import { Emoji } from "../style";
import { addAlert, postSystemMessage, removeAlert } from "../thread";
import { afterThreadClose } from "../hooks/afterThreadClose";
import { clearThreadAlerts } from "../repositories/alerts";

export default ({ db, config, commands }: ModuleProps) => {
  afterThreadClose(async ({ threadId }) => {
    await clearThreadAlerts(db, threadId);
  });

  commands.addInboxThreadCommand(
    "alert",
    "[opt:string]",
    async (msg: Message, args, thread: Thread) => {
      if (!thread) return;

      if (args.opt && (args.opt as string).startsWith("c")) {
        await removeAlert(db, thread, msg.author.id);
        await postSystemMessage(
          db,
          thread,
          `${Emoji.CheckBadge} Cancelled new message alert`,
        );

        return;
      }

      const sticky = args.opt
        ? (args.opt as string).startsWith("sticky") ||
          (args.opt as string).startsWith("s")
        : false;

      await addAlert(db, thread, msg.author.id, sticky);

      const replyName =
        msg.member?.nickname || config.useDisplaynames
          ? msg.author.globalName || msg.author.username
          : msg.author.username;

      await postSystemMessage(
        db,
        thread,
        `${Emoji.Schedule} Pinging ${replyName} ${sticky ? "whenever there is a new reply" : "on the next reply"}`,
      );
    },
    { allowSuspended: true },
  );
};
