import type { ModuleProps } from "../plugins";

export default ({ commands, bot }: ModuleProps) => {
  console.log("Loaded info plugin");

  commands.addInboxThreadCommand(
    "header",
    "",
    async (msg, _args, thread) => {
      if (!thread || !msg.channel.isSendable()) return;

      const user = await bot.users.fetch(thread.user_id);
      if (!user) return;

      thread.postInfoHeader(user, false);
    },
    {},
  );
};
