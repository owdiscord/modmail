import type { Message } from "discord.js";
import type { Thread } from "../data/Thread";
import type { ModuleProps } from "../plugins";
import { Emoji } from "../style";
import { addAlert, postSystemMessage, removeAlert } from "../thread";

export default ({ db, config, commands }: ModuleProps) => {
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
      } else {
        await addAlert(db, thread, msg.author.id);
        await postSystemMessage(
          db,
          thread,
          `${Emoji.Schedule} Pinging ${msg.member?.nickname || config.useDisplaynames ? msg.author.globalName || msg.author.username : msg.author.username} when this thread gets a new reply`,
        );
      }
    },
    { allowSuspended: true },
  );
};
