import { Events } from "discord.js";
import type Thread from "../data/Thread";
import type { ModuleProps } from "../plugins";
import * as threads from "../repositories/threads";
import { postSystemMessage } from "../thread";
import * as utils from "../utils";

export default ({ bot, config, db }: ModuleProps) => {
  const leaveIgnoreIDs: string[] = [];

  // Join Notification: Post a message in the thread if the user joins a main server
  if (config.notifyOnMainServerJoin) {
    bot.on(Events.GuildMemberAdd, async ({ user, guild }) => {
      const mainGuilds = utils.getMainGuilds();
      if (!mainGuilds.find((gld) => gld.id === guild.id)) return;

      const thread = (
        await threads.findOpenThreadByUserID(db, user.id)
      )[0] as Thread;

      if (thread != null) {
        await postSystemMessage(
          db,
          thread,
          `***The user joined the ${guild.name} server.***`,
        );
      }
    });
  }

  // Leave Notification: Post a message in the thread if the user leaves a main server
  if (config.notifyOnMainServerLeave) {
    bot.on(Events.GuildMemberRemove, async ({ guild, user }) => {
      const mainGuilds = utils.getMainGuilds();
      if (!mainGuilds.find((gld) => gld.id === guild.id)) return;

      // Ensure that possible ban events are caught before sending message (race condition)
      setTimeout(async () => {
        const thread = (
          await threads.findOpenThreadByUserID(db, user.id)
        )[0] as Thread;

        if (thread != null) {
          if (leaveIgnoreIDs.includes(user.id)) {
            leaveIgnoreIDs.splice(leaveIgnoreIDs.indexOf(user.id), 1);
          } else {
            await postSystemMessage(
              db,
              thread,
              `***The user left the ${guild.name} server.***`,
            );
          }
        }
      }, 2 * 1000);
    });
  }

  // Leave Notification: Post a message in the thread if the user is banned from a main server
  if (config.notifyOnMainServerLeave) {
    bot.on(Events.GuildBanAdd, async ({ user, guild }) => {
      const mainGuilds = utils.getMainGuilds();
      if (!mainGuilds.find((gld) => gld.id === guild.id)) return;

      const thread = (
        await threads.findOpenThreadByUserID(db, user.id)
      )[0] as Thread;

      if (thread != null) {
        await postSystemMessage(
          db,
          thread,
          `***The user was banned from the ${guild.name} server.***`,
        );
        leaveIgnoreIDs.push(user.id);
      }
    });
  }

  // "Join" Notification: Post a message in the thread if the user is unbanned from a main server
  if (config.notifyOnMainServerJoin) {
    bot.on(Events.GuildBanRemove, async ({ guild, user }) => {
      const mainGuilds = utils.getMainGuilds();
      if (!mainGuilds.find((gld) => gld.id === guild.id)) return;

      const thread = (
        await threads.findOpenThreadByUserID(db, user.id)
      )[0] as Thread;

      if (thread != null) {
        await postSystemMessage(
          db,
          thread,
          `***The user was unbanned from the ${guild.name} server.***`,
        );
      }
    });
  }
};
