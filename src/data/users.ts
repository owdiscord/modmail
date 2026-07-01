import type { Client, GuildMember, User } from "discord.js";
import config from "../config";

export interface GuildStatus {
  main: GuildMember | null;
  ban: GuildMember | null;
}

export async function userGuildStatus(
  bot: Client,
  user: User,
): Promise<GuildStatus> {
  const mainGuild = await bot.guilds.fetch(config.overwatchGuildId);
  const banGuild = await bot.guilds.fetch(config.banGuildId);

  const output: {
    main: GuildMember | null;
    ban: GuildMember | null;
  } = {
    main: null,
    ban: null,
  };

  try {
    const member = await mainGuild.members.fetch(user.id);
    output.main = member;
  } catch (_e) {
    output.main = null;
  }

  try {
    const member = await banGuild.members.fetch(user.id);
    output.ban = member;
  } catch (_e) {
    output.ban = null;
  }

  return output;
}
