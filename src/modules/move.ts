import type { ModuleProps } from "../plugins";
import { slugify } from "../utils";
import { ChannelType, GuildChannel } from "discord.js";

export default ({ bot, config, commands }: ModuleProps) => {
  if (!config.allowMove) return;

  commands.addInboxThreadCommand(
    "move",
    "<category:string$>",
    async (_msg, args, thread) => {
      const searchStr = args.category;
      const normalizedSearchStr = slugify(searchStr);

      const channel = await bot.channels.fetch(thread.channel_id);

      // Impossible
      if (!channel || channel.isDMBased() || !(channel instanceof GuildChannel))
        return;

      await channel.guild.channels.fetch();
      const channels = channel.guild.channels.cache;
      const categories = channels.filter(
        (c) =>
          c.type === ChannelType.GuildCategory && c.id !== channel.parentId,
      );

      if (categories.size === 0) return;

      // See if any category name contains a part of the search string
      const containsRankings = categories.map((cat) => {
        const normalizedCatName = slugify(cat?.name || "");

        let i = 0;
        do {
          if (!normalizedCatName.includes(normalizedSearchStr.slice(0, i + 1)))
            break;
          i++;
        } while (i < normalizedSearchStr.length);

        if (
          i > 0 &&
          normalizedCatName.startsWith(normalizedSearchStr.slice(0, i))
        ) {
          // Slightly prioritize categories that *start* with the search string
          i += 0.5;
        }

        return { category: cat, score: i };
      });

      // Sort by best match
      containsRankings.sort((a, b) => {
        return a.score > b.score ? -1 : 1;
      });

      if (containsRankings.length === 0 || containsRankings[0]?.score === 0) {
        thread.postSystemMessage("No matching category");
        return;
      }

      const targetCategory = containsRankings[0]?.category;
      if (!targetCategory) return;

      try {
        await channel.setParent(targetCategory.id, {
          lockPermissions: config.syncPermissionsOnMove,
        });
      } catch (e: any) {
        thread.postSystemMessage(`Failed to move thread: ${e.message}`);
        return;
      }

      thread.postSystemMessage(
        `⇅ Thread moved to **${targetCategory.name.toUpperCase()}**`,
      );
    },
  );
};
