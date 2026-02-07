import type { GuildMember, GuildMemberRoleManager } from "discord.js";
import {
  createUserRegistration,
  deleteUserRegistration,
  deregisterUser,
} from "../data/Registration";
import type { ModuleProps } from "../plugins";
import { Emoji } from "../style";
import { isSnowflake } from "../utils";

export default ({ db, commands }: ModuleProps) => {
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
        await createUserRegistration(db, userId, name);
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
};
