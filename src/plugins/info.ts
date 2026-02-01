import type { DiscordAPIError, Guild, GuildMember } from "discord.js";
import type { ModuleProps } from "../plugins";
import { getMainGuilds } from "../utils";

export default ({ commands, bot }: ModuleProps) => {
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

      thread.postInfoHeader(user, userGuildData, false);
    },
    {},
  );
};
