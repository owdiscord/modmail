import logger from "../logger";
import type { ModuleProps } from "../plugins";
import {
  getModeratorDefaultDisplayRoleName,
  getModeratorThreadDisplayRoleName,
  resetModeratorDefaultRoleOverride,
  resetModeratorThreadRoleOverride,
  setModeratorDefaultRoleOverride,
  setModeratorThreadRoleOverride,
} from "../repositories/displayRoles";
import { postSystemMessage } from "../thread";
import { getInboxGuild, isSnowflake } from "../utils";

export default ({ db, config, commands }: ModuleProps) => {
  if (!config.allowChangingDisplayRole) {
    return;
  }

  async function resolveRoleInput(input: string) {
    const guild = getInboxGuild();

    if (isSnowflake(input)) {
      return await guild.roles.fetch(input);
    }

    // Put roles into the cache
    await guild.roles.fetch();
    const res = guild.roles.cache.find(
      (r) =>
        r.name.toLowerCase().trim() === input.toLowerCase().trim() ||
        r.name.toLowerCase().trim().startsWith(input.toLowerCase().trim()),
    );
    return res;
  }

  // Get display role for a thread
  commands.addInboxServerCommand(
    "role",
    [],
    async (msg, _args, thread) => {
      if (thread) {
        if (!msg.member) return;

        const displayRole = await getModeratorThreadDisplayRoleName(
          msg.member,
          thread.id,
        );
        if (displayRole) {
          postSystemMessage(
            db,
            thread,
            `Your display role in this thread is currently **${displayRole}**`,
          );
        } else {
          postSystemMessage(
            db,
            thread,
            "Your replies in this thread do not currently display a role",
          );
        }
        return;
      }

      // Not in a thread, so we fall back to the default role
      const channel = await msg.channel.fetch();
      if (!msg.member || !channel?.isSendable()) {
        logger.error(
          { member: msg.member, isSend: channel.isSendable() },
          "could not view role",
        );
        return;
      }

      const displayRole = await getModeratorDefaultDisplayRoleName(msg.member);
      if (displayRole) {
        channel.send(
          `Your default display role is currently **${displayRole}**`,
        );
      } else {
        channel.send("Your replies do not currently display a role by default");
      }
    },
    { allowSuspended: true },
  );

  // Reset display role for a thread
  commands.addInboxServerCommand(
    "role reset",
    [],
    async (msg, _args, thread) => {
      if (thread) {
        if (!msg.member) return;

        await resetModeratorThreadRoleOverride(msg.member.id, thread.id);

        const displayRole = await getModeratorThreadDisplayRoleName(
          msg.member,
          thread.id,
        );
        if (displayRole) {
          postSystemMessage(
            db,
            thread,
            `Your display role for this thread has been reset. Your replies will now display the default role **${displayRole}**.`,
          );
        } else {
          postSystemMessage(
            db,
            thread,
            "Your display role for this thread has been reset. Your replies will no longer display a role.",
          );
        }
        return;
      }

      // Not in a thread, so we fall back to the default role
      const channel = await msg.channel.fetch();
      if (!msg.member || !channel?.isSendable()) {
        logger.error(
          { member: msg.member, isSend: channel.isSendable() },
          "could not reset role in inbox channel",
        );
        return;
      }

      try {
        await resetModeratorDefaultRoleOverride(msg.member.id);
      } catch (e) {
        logger.error(
          { db_error: e },
          "could not run database query to reset default role",
        );
      }

      const displayRole = await getModeratorDefaultDisplayRoleName(msg.member);
      if (displayRole) {
        channel.send(
          `Your default display role has been reset. Your replies will now display the role **${displayRole}** by default.`,
        );
      } else {
        channel.send(
          "Your default display role has been reset. Your replies will no longer display a role by default.",
        );
      }
    },
    {
      aliases: ["role_reset", "reset_role"],
      allowSuspended: true,
    },
  );

  // Set display role for a thread
  commands.addInboxServerCommand(
    "role",
    "<role:string$>",
    async (msg, args, thread) => {
      if (thread) {
        if (!msg.member) return;

        const role = await resolveRoleInput(args.role as string);
        if (!role || !msg.member.roles.cache.has(role.id)) {
          postSystemMessage(
            db,
            thread,
            "No matching role found. Make sure you have the role before trying to set it as your display role in this thread.",
          );
          return;
        }

        await setModeratorThreadRoleOverride(msg.member.id, thread.id, role.id);
        postSystemMessage(
          db,
          thread,
          `Your display role for this thread has been set to **${role.name}**. You can reset it with \`${config.prefix}role reset\`.`,
        );
        return;
      }

      // Not in a thread, so we fall back to the default role
      const channel = await msg.channel.fetch();
      const role = await resolveRoleInput(args.role as string);
      if (!role || !msg.member || !channel?.isSendable()) {
        logger.error(
          { role, member: msg.member, isSend: channel.isSendable() },
          "could set role in inbox channel",
        );
        return;
      }

      const hasRole = msg.member?.roles.resolve(role.id);

      if (!hasRole) {
        channel.send(
          "No matching role found. Make sure you have the role before trying to set it as your default display role.",
        );
        return;
      }

      await setModeratorDefaultRoleOverride(msg.member?.id || "", role.id);
      channel.send(
        `Your default display role has been set to **${role.name}**. You can reset it with \`${config.prefix}role reset\`.`,
      );
    },
    { allowSuspended: true },
  );
};
