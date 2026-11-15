import type { GuildMember } from "discord.js";
import type { ModuleProps } from "../plugins";
import {
  createUserRegistration,
  deregisterUser,
  updateRegisteredUserAvatar,
} from "../repositories/registration";
import { Emoji } from "../style";
import { isSnowflake } from "../utils";
import { downloadBasicAvatar } from "../data/avatars";

export default ({ bot, db, commands }: ModuleProps) => {
  function isAdmin(user: GuildMember): boolean {
    // 1462792136419311679 = test server admin role ID
    // 259251598621016074 = real server admin role ID

    return user.roles.cache?.hasAny(
      "1462792136419311679",
      "259251598621016074",
    );
  }

  commands.addInboxServerCommand(
    "register",
    [
      { name: "userId", type: "string" },
      { name: "name", type: "string" },
    ],
    async (msg, args, _thread) => {
      if (!msg.channel.isSendable() || !msg.member) return;

      if (!isAdmin(msg.member)) {
        msg.channel.send(
          `Sorry! You can't use this command, it is ${Emoji.Roles.Admin} **Admin Only!**`,
        );
        return;
      }

      const { userId, name } = args as {
        userId: string;
        name: string;
      };

      if (!isSnowflake(userId)) {
        msg.channel.send(`The user ID given is not a snowflake.`);
        return;
      }

      try {
        const discordUser = await bot.users.fetch(userId);

        if (discordUser.avatar)
          await downloadBasicAvatar(userId, discordUser.avatar);

        await createUserRegistration(
          db,
          userId,
          discordUser.avatar || "",
          name,
        );
        msg.channel.send(
          `User <@${userId}> is now registered as **"${name}"**`,
        );
      } catch (err) {
        msg.channel.send(
          `Looks like we have an issue registering that user: ${err}`,
        );
      }
    },
    {},
  );
  commands.addInboxServerCommand(
    "deregister",
    [{ name: "userId", type: "string" }],
    async (msg, args, _thread) => {
      if (!msg.channel.isSendable() || !msg.member) return;

      if (!isAdmin(msg.member)) {
        msg.channel.send(
          `Sorry! You can't use this command, it is ${Emoji.Roles.Admin} **Admin Only!**`,
        );
        return;
      }

      const userId = args.userId as string;

      if (!isSnowflake(userId)) {
        msg.channel.send(`The user ID given is not a snowflake.`);
        return;
      }

      try {
        await deregisterUser(db, userId);
        msg.channel.send(`User <@${userId}> is now using their display name.`);
      } catch (err) {
        msg.channel.send(
          `Looks like we have an issue deregistering that user: ${err}`,
        );
      }
    },
    {},
  );
  commands.addInboxServerCommand(
    "refresh_avatar",
    [{ name: "userId", type: "string" }],
    async (msg, args, _thread) => {
      if (!msg.channel.isSendable() || !msg.member) return;

      if (!isAdmin(msg.member)) {
        msg.channel.send(
          `Sorry! You can't use this command, it is ${Emoji.Roles.Admin} **Admin Only!**`,
        );
        return;
      }

      const userId = args.userId as string;

      if (!isSnowflake(userId)) {
        msg.channel.send(`The user ID given is not a snowflake.`);
        return;
      }

      try {
        const discordUser = await bot.users.fetch(userId);
        if (discordUser.avatar) {
          await downloadBasicAvatar(userId, discordUser.avatar);
          await updateRegisteredUserAvatar(
            db,
            userId,
            discordUser.avatar || "",
          );
          msg.channel.send(`User <@${userId}>'s avatar has been updated.`);
          return;
        }

        msg.channel.send(`User <@${userId}> doesn't have an avatar. `);
      } catch (err) {
        msg.channel.send(
          `Looks like we have an issue updating that user: ${err}`,
        );
      }
    },
    {},
  );
};
