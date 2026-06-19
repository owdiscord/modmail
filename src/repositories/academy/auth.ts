import type { DbQuery } from "../../db";
import logger from "../../logger";
import { randomBytes } from "node:crypto";

export interface Session {
  user_id: number;
  wave_id: number;
  role: string;
  expires_at: number;
}

/*
 * # In-memory session cache
 *
 * It would be cruel to our database to make an request for every hit on the API, so
 * to save her some effort, we're caching (with a short TTL) the sessions in-memory.
 *
 * Thanks Node being single threaded, just this once...
 * */

interface CachedSession {
  data: Session;
  expires_at: number;
}

const sessionCache = new Map<string, CachedSession>();

// 5 minutes, in milliseconds.
const ttl = 5 * 60 * 1000;

export function getCachedSession(id: string): Session | null {
  const entry = sessionCache.get(id);
  if (!entry) return null;

  // If it's after the expiry time, delete the session from cache and return null.
  if (Date.now() > entry.expires_at) {
    sessionCache.delete(id);
    return null;
  }

  return entry.data;
}

export function setCachedSession(id: string, data: Session) {
  sessionCache.set(id, {
    data,
    expires_at: Date.now() + ttl,
  });
}

export function invalidateCachedSession(id: string) {
  sessionCache.delete(id);
}

/*
 * # Database queries
 */

// Sessions last 1 week, aka 7 days x 24 hours x 60 seconds x 1000 milliseconds
const sessionExpiry = 7 * 24 * 60 * 60 * 1000;

// Create a new session and return the ID
export async function createSession(
  sql: DbQuery,
  user_id: number,
  wave_id: number,
): Promise<{ token: string; expires: Date } | null> {
  try {
    // Use pseudo-random bytes as our session key
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + sessionExpiry);

    await sql`INSERT INTO academy_sessions (
    token,
    user_id,
    wave_id,
    expires_at
  ) VALUES (
    ${token},
    ${user_id},
    ${wave_id},
    ${expires}
  )`;

    return { token, expires };
  } catch (err) {
    logger.error({ err }, "could not create session");
    return null;
  }
}

// Get a session by it's ID
export async function getSessionByID(
  sql: DbQuery,
  session_id: string,
): Promise<Session | null> {
  const res =
    await sql`SELECT s.user_id, s.wave_id, s.expires_at, u.role FROM academy_sessions s INNER JOIN academy_staff u ON u.id = s.user_id WHERE s.id = ${session_id} AND expires_at > NOW()`;

  return res[0] ? (res[0] as Session) : null;
}

// Get a session by it's ID
export async function getSessionByToken(
  sql: DbQuery,
  token: string,
): Promise<Session | null> {
  const res =
    await sql`SELECT s.user_id, s.wave_id, s.expires_at, u.role FROM academy_sessions s INNER JOIN academy_staff u ON u.id = s.user_id WHERE s.token = ${token} AND expires_at > NOW()`;

  return res[0] ? (res[0] as Session) : null;
}

// Get a session by a given Discord ID (snowflake). This also requires the wave ID, because
// otherwise there can be many returned, in theory.
export async function getSessionByDiscordID(
  sql: DbQuery,
  discord_id: string,
  wave_id: number,
): Promise<Session | null> {
  const res =
    await sql`SELECT s.discord_id, s.wave_id, s.expires_at, u.role FROM academy_sessions s INNER JOIN academy_staff u ON u.id = s.user_id WHERE s.user_id = ${discord_id} AND s.wave_id = ${wave_id}`;

  return res[0] ? (res[0] as Session) : null;
}

// Clear a session from the database by it's ID
export async function deleteSessionByID(sql: DbQuery, id: string) {
  return await sql`DELETE FROM academy_sessions WHERE id = ${id}`;
}

// Clear a session from the database by it's ID
export async function deleteSessionByToken(sql: DbQuery, token: string) {
  return await sql`DELETE FROM academy_sessions WHERE token = ${token}`;
}

// Ensure a given discord ID (snowflake) has permission to access at least one
// wave, returning the latest wave ID.
export async function latestUserForDiscordID(
  sql: DbQuery,
  discord_id: string,
): Promise<{ id: number; wave_id: number; role: string } | null> {
  const res =
    await sql`SELECT id, wave_id, role FROM academy_staff WHERE snowflake = ${discord_id} ORDER BY wave_id DESC LIMIT 1`;

  return (res[0] as { id: number; wave_id: number; role: string }) || null;
}

// Get the basic details for a single user
export async function getUserDetails(
  sql: DbQuery,
  wave_id: number,
  user_id: number,
) {
  const res =
    await sql`SELECT snowflake, username, display_name, role FROM academy_staff WHERE id = ${user_id} AND wave_id = ${wave_id}`;

  return (
    (res[0] as {
      snowflake: string;
      username: string;
      display_name: string;
      role: string;
    }) || null
  );
}
