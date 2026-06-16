import type { RowDataPacket } from "mysql2";
import type { DbQuery } from "../../db";
import { v7 } from "uuid";
import logger from "../../logger";

export interface Session {
  discord_id: string;
  wave_id: number;
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
const sessionExpiry = 7 * 24 * 60 * 1000;

// Create a new session and return the ID
export async function createSession(
  sql: DbQuery,
  discord_id: string,
  wave_id: number,
): Promise<{ id: string; expires: Date } | null> {
  try {
    // Use UUIDv7 as our session key
    const id = v7();
    const expires = new Date(Date.now() + sessionExpiry);

    await sql`INSERT INTO academy_sessions (
    id,
    discord_id,
    wave_id,
    expires_at
  ) VALUES (
    ${id},
    ${discord_id},
    ${wave_id},
    ${expires}
  )`;

    return { id, expires };
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
    await sql`SELECT id, discord_id, wave_id, expires_at FROM academy_sessions WHERE id = ${session_id} AND expires_at > NOW()`;

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
    await sql`SELECT id, discord_id, wave_id, expires_at FROM academy_sessions WHERE discord_id = ${discord_id} AND wave_id = ${wave_id}`;

  return res[0] ? (res[0] as Session) : null;
}

// Clear a session from the database by it's ID
export async function deleteSessionByID(sql: DbQuery, id: string) {
  return await sql`DELETE FROM academy_sessions WHERE id = ${id}`;
}

// Ensure a given discord ID (snowflake) has permission to access at least one
// wave, returning the latest wave ID.
export async function waveForDiscordID(
  sql: DbQuery,
  discord_id: string,
): Promise<number | null> {
  const res =
    await sql`SELECT wave_id FROM academy_staff WHERE snowflake = ${discord_id} ORDER BY wave_id DESC LIMIT 1`;

  return res[0]?.wave_id || null;
}
