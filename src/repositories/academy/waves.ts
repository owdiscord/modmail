import type { RowDataPacket } from "mysql2";
import type { DbQuery } from "../../db";

export type WaveState = "interviews" | "helper" | "historic";

export interface Wave {
  id: number;
  created_at: Date;
  state: WaveState;
  begin_at: Date;
  close_at: Date;
}

export interface Trainee {
  id: string;
  name: string;
  thread_participation_count: number;
  message_count: number;
  case_count: number;
}

export async function getWaveDetails(
  sql: DbQuery,
  id: number,
): Promise<(Wave & { trainees: Trainee[] }) | null> {
  const details = (
    await sql`SELECT id, state, UNIX_TIMESTAMP(begin_at) begin_at, UNIX_TIMESTAMP(close_at) close_at, UNIX_TIMESTAMP(created_at) created_at FROM academy_waves WHERE id = ${id}`
  )[0];
  if (!details) return null;

  const trainees = await sql<
    RowDataPacket & Trainee
  >`SELECT snowflake id, display_name name, thread_participation_count, message_count, case_count FROM academy_staff WHERE wave_id = ${id} AND role = 'trainee'`;

  return {
    id: details.id,
    created_at: details.created_at,
    state: details.state,
    begin_at: details.begin_at,
    close_at: details.close_at,
    trainees,
  };
}
