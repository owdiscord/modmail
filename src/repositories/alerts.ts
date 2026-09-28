import type { RowDataPacket } from "mysql2";
import type { DbQuery } from "../db";

export interface Alert {
  thread_id: string;
  user_id: string;
  is_sticky: boolean;
}

export type AlertRow = Alert & RowDataPacket;

export async function getThreadAlerts(
  sql: DbQuery,
  thread_id: string,
): Promise<Array<AlertRow>> {
  return await sql`SELECT thread_id, user_id, is_sticky FROM thread_alerts WHERE thread_id = ${thread_id}`;
}

export async function addThreadAlert(
  sql: DbQuery,
  thread_id: string,
  user_id: string,
  sticky: boolean,
) {
  return await sql.mutation`INSERT INTO thread_alerts (thread_id, user_id, is_sticky) VALUES (${thread_id}, ${user_id}, ${sticky})
    ON DUPLICATE KEY UPDATE is_sticky = ${sticky};`;
}

export async function removeThreadAlert(
  sql: DbQuery,
  thread_id: string,
  user_id: string,
) {
  return await sql.mutation`DELETE FROM thread_alerts WHERE thread_id = ${thread_id} AND user_id = ${user_id}`;
}

export async function clearThreadAlerts(sql: DbQuery, thread_id: string) {
  return await sql.mutation`DELETE FROM thread_alerts WHERE thread_id = ${thread_id}`;
}

export async function clearNonStickyThreadAlerts(
  sql: DbQuery,
  thread_id: string,
) {
  return await sql.mutation`DELETE FROM thread_alerts WHERE thread_id = ${thread_id} AND is_sticky = false`;
}

export async function toggleThreadAlertSticky(
  sql: DbQuery,
  thread_id: string,
  user_id: string,
) {
  return await sql.mutation`UPDATE thread_alerts SET is_sticky = NOT is_sticky WHERE thread_id = ${thread_id} AND user_id = ${user_id}`;
}
