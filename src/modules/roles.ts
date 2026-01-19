import type { ModuleProps } from "../plugins";
import { getInboxGuild, isSnowflake, getOrFetchChannel } from "../utils";
import {
  setModeratorDefaultRoleOverride,
  resetModeratorDefaultRoleOverride,
  setModeratorThreadRoleOverride,
  resetModeratorThreadRoleOverride,
  getModeratorThreadDisplayRoleName,
  getModeratorDefaultDisplayRoleName,
} from "../data/displayRoles";
import type Thread from "../data/Thread";
import type { Message } from "discord.js";

export default ({ bot, config, commands }: ModuleProps) => {
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
        r.name.toLowerCase() === input.toLowerCase() ||
        r.name.toLowerCase().startsWith(input.toLowerCase()),
    );
    return res;
  }

  // Get display role for a thread
  commands.addInboxThreadCommand(
    "role",
    [],
    async (msg, _args, thread) => {
      if (!thread || !msg.member) return;

      const displayRole = await getModeratorThreadDisplayRoleName(
        msg.member,
        thread.id,
      );
      if (displayRole) {
        thread.postSystemMessage(
          `Your display role in this thread is currently **${displayRole}**`,
        );
      } else {
        thread.postSystemMessage(
          "Your replies in this thread do not currently display a role",
        );
      }
    },
    { allowSuspended: true },
  );

  // Reset display role for a thread
  commands.addInboxThreadCommand(
    "role reset",
    [],
    async (msg, _args, thread) => {
      if (!thread || !msg.member) return;

      await resetModeratorThreadRoleOverride(msg.member.id, thread.id);

      const displayRole = await getModeratorThreadDisplayRoleName(
        msg.member,
        thread.id,
      );
      if (displayRole) {
        thread.postSystemMessage(
          `Your display role for this thread has been reset. Your replies will now display the default role **${displayRole}**.`,
        );
      } else {
        thread.postSystemMessage(
          "Your display role for this thread has been reset. Your replies will no longer display a role.",
        );
      }
    },
    {
      aliases: ["role_reset", "reset_role"],
      allowSuspended: true,
    },
  );

  // Set display role for a thread
  commands.addInboxThreadCommand(
    "role",
    "<role:string$>",
    async (msg, args, thread) => {
      if (!thread || !msg.member) return;

      const role = await resolveRoleInput(args.role as string);
      if (!role || !msg.member.roles.cache.has(role.id)) {
        thread.postSystemMessage(
          "No matching role found. Make sure you have the role before trying to set it as your display role in this thread.",
        );
        return;
      }

      await setModeratorThreadRoleOverride(msg.member.id, thread.id, role.id);
      thread.postSystemMessage(
        `Your display role for this thread has been set to **${role.name}**. You can reset it with \`${config.prefix}role reset\`.`,
      );
    },
    { allowSuspended: true },
  );

  // Get default display role
  commands.addInboxServerCommand("role", [], async (msg, _args, _thread) => {
    const channel = await getOrFetchChannel(bot, msg.channel.id);
    if (!msg.member || !channel || !channel.isSendable()) return;

    const displayRole = await getModeratorDefaultDisplayRoleName(msg.member);
    if (displayRole) {
      channel.send(`Your default display role is currently **${displayRole}**`);
    } else {
      channel.send("Your replies do not currently display a role by default");
    }
  });

  // Reset default display role
  commands.addInboxServerCommand(
    "role reset",
    [],
    async (msg, _args, _thread) => {
      const channel = await getOrFetchChannel(bot, msg.channel.id);
      if (!msg.member || !channel || !channel.isSendable()) return;

      await resetModeratorDefaultRoleOverride(msg.member.id);

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
    },
  );

  // Set default display role
  commands.addInboxServerCommand(
    "role",
    "<role:string$>",
    async (msg: Message, args: Record<string, unknown>, _thread?: Thread) => {
      const channel = await getOrFetchChannel(bot, msg.channel.id);
      const role = await resolveRoleInput(args.role as string);
      if (!role || !msg.member || !channel || !channel.isSendable()) return;

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
  );
};
