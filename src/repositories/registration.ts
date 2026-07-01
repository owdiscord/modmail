import type { GuildMember } from "discord.js";
import type { RowDataPacket } from "mysql2";
import { createCache } from "../cache";
import config from "../config";
import { type DbQuery, useDb } from "../db";

export interface Registration {
  discord_id: string;
  registered_name: string;
  created_at: Date;
  updated_at: Date;
}

export type RegistrationRow = Registration & RowDataPacket;

// User registration cache, with a 30 minute time-to-live.
const cache = createCache<string>(30 * 60 * 1000);

export async function createUserRegistration(
  db: DbQuery,
  discord_id: string,
  registered_name: string,
): Promise<null> {
  await db.mutation`INSERT INTO registered_users
    (discord_id, registered_name, created_at) VALUES
    (${discord_id}, ${registered_name}, now()) ON DUPLICATE KEY UPDATE registered_name = ${registered_name}, updated_at = now();`;

  return null;
}

export async function getUserRegistrationByDiscord(
  db: DbQuery,
  discord_id: string,
): Promise<Registration | null> {
  const registration =
    await db<RegistrationRow>`SELECT * FROM registered_users WHERE discord_id = ${discord_id}`;

  return registration?.[0] ? registration[0] : null;
}

export async function getUserRegistrationName(
  db: DbQuery,
  discord_id: string,
): Promise<string | null> {
  const registration =
    await db<RegistrationRow>`SELECT registered_name FROM registered_users WHERE discord_id = ${discord_id}`;

  return registration?.[0] ? registration[0].registered_name : null;
}

export async function deleteUserRegistration(db: DbQuery, discord_id: string) {
  return await db`DELETE FROM registered_users WHERE discord_id = ${discord_id}`;
}

export async function cacheRegisteredUser(db: DbQuery, discord_id: string) {
  const registeredName = await getUserRegistrationName(db, discord_id);
  if (registeredName) cache.set(discord_id, registeredName);
}

export async function deregisterUser(db: DbQuery, discord_id: string) {
  cache.del(discord_id);

  await deleteUserRegistration(db, discord_id);
}

export async function getRegisteredUsername(
  db: DbQuery,
  discord_id: string,
): Promise<string | null> {
  const cached = cache.get(discord_id);
  if (cached) return cached;

  const registeredName = await getUserRegistrationName(db, discord_id);
  if (registeredName) cache.set(discord_id, registeredName);

  return registeredName;
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
