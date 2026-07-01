import type { ModuleProps } from "../plugins";
import {
  findOpenThreadByChannelID,
  resetThreadID,
} from "../repositories/threads";
import { getThreadChannel, postSystemMessage } from "../thread";
import { postLog } from "../utils";

export default ({ db, commands, config }: ModuleProps) => {
  commands.addGlobalCommand(
    "resetid",
    [
      {
        name: "id",
        type: "string",
        required: false,
      },
    ],
    async (msg, args) => {
      const thread = await findOpenThreadByChannelID(db, msg.channelId);
      if (!thread && !args.id) {
        msg.reply(
          "You aren't in a thread and didn't specify an ID, so I don't know what to do next!",
        );
        return;
      }

      const fromID = thread ? thread.id : (args.id as string);
      const newID = await resetThreadID(db, fromID);

      const channel = thread ? await getThreadChannel(thread) : msg.channel;

      if (!channel.isSendable())
        return postLog(
          `We reset thread ${fromID} to ${newID}, but could not respond to the original message.`,
        );

      channel.send(`✓ Thread \`${fromID}\` is now \`${newID}\``);
      if (channel.id !== config.logChannel)
        postLog(`Thread \`${fromID}\` is now \`${newID}\``);
    },
    {},
  );

  commands.addInboxThreadCommand(
    "id",
    [],
    async (_msg, _args, thread) => {
      if (!thread) return;
      postSystemMessage(db, thread, thread.user_id);
    },
    { allowSuspended: true },
  );
};
