import type { SQL } from "bun";
import { GuildMember } from "discord.js";
import { useDb } from "../db";
import config from "../config";

type RegistrationProps = {
  discord_id: string;
  registered_name: string;
  created_at: Date;
  updated_at: Date;
};

const sql_table_name = "registered_users";

export class Registration {
  public sql_table_name = sql_table_name;

  public discord_id: string;
  public registered_name: string;
  public created_at: Date;
  public updated_at: Date;

  constructor(props: RegistrationProps) {
    this.discord_id = props.discord_id;
    this.registered_name = props.registered_name;
    this.created_at = props.created_at;
    this.updated_at = props.updated_at;
  }
}

export async function createUserRegistration(
  db: SQL,
  discord_id: string,
  registered_name: string,
): Promise<null> {
  return await db`INSERT INTO ${db(sql_table_name)}
    (discord_id, registered_name, created_at) VALUES
    (${discord_id}, ${registered_name}, now()) ON DUPLICATE KEY UPDATE registered_name = ${registered_name}, updated_at = now();`;
}

export async function getUserRegistrationByDiscord(
  db: SQL,
  discord_id: string,
): Promise<Registration | null> {
  const registration =
    await db`SELECT * FROM ${db(sql_table_name)} WHERE discord_id = ${discord_id}`;

  if (registration && registration.length > 0)
    return new Registration(registration[0]);

  return null;
}

export async function getUserRegistrationName(
  db: SQL,
  discord_id: string,
): Promise<string | null> {
  const registration =
    await db`SELECT registered_name FROM ${db(sql_table_name)} WHERE discord_id = ${discord_id}`;

  if (registration && registration.length > 0)
    return registration[0].registered_name;

  return null;
}

export async function deleteUserRegistration(db: SQL, discord_id: string) {
  return await db`DELETE FROM ${db(sql_table_name)} WHERE discord_id = ${discord_id}`;
}

export const userRegistrationCache: Record<string, string> = {};

export async function cacheRegisteredUser(db: SQL, discord_id: string) {
  const registration = await getUserRegistrationName(db, discord_id);
  if (registration) userRegistrationCache[discord_id] = registration;
}

export async function deregisterUser(db: SQL, discord_id: string) {
  delete userRegistrationCache[discord_id];

  await deleteUserRegistration(db, discord_id);
}

export async function getRegisteredUsername(
  db: SQL,
  discord_id: string,
): Promise<string | null> {
  const cached = userRegistrationCache[discord_id];
  if (cached) return cached;

  const registration = await getUserRegistrationName(db, discord_id);
  if (registration) userRegistrationCache[discord_id] = registration;
  return registration;
}

export async function getStaffUsername(member: GuildMember): Promise<string> {
  const db = useDb();
  const registeredName = await getRegisteredUsername(db, member.id);

  if (registeredName) return registeredName;

  const regularName = config.useDisplaynames
    ? member.user.globalName || member.user.username
    : member.user.username;

  return config.useNicknames && member.nickname ? member.nickname : regularName;
}
