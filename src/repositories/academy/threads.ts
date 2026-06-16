import type { DbQuery } from "../../db";

type WaveThreadStatus = "open" | "closed" | "unknown";

export interface TraineeThread {
  id: string;
  user_name: string;
  user_id: string;
  created_at: number;
  status: WaveThreadStatus;
  reply_messages: number;
  user_message: number;
  internal_message: number;
  staff_ids: string[];
}

export async function getWaveThreads(
  sql: DbQuery,
  wave_id: number,
): Promise<TraineeThread[] | null> {
  const traineeIDs = (
    await sql`SELECT snowflake FROM academy_staff WHERE wave_id = ${wave_id}`
  )
    .map((s) => s.snowflake)
    .join("', '");

  const threads = await sql.raw(
    `SELECT
      t.id,
      t.user_name,
      t.user_id,
      UNIX_TIMESTAMP(t.created_at) AS created_at,
      CASE t.status
        WHEN 1 THEN 'open'
        WHEN 2 THEN 'closed'
        ELSE 'unknown'
      END as status,
      COUNT(CASE WHEN m.message_type = 3 THEN 1 END) as reply_messages,
      COUNT(CASE WHEN m.message_type = 4 THEN 1 END) as user_messages,
      COUNT(CASE WHEN m.message_type = 2 THEN 1 END) as internal_messages,
      GROUP_CONCAT(DISTINCT m.user_id ORDER BY m.user_id SEPARATOR '|') AS staff_ids
    FROM threads t
      LEFT JOIN thread_messages m ON m.thread_id = t.id
      WHERE t.status < 3
        AND EXISTS (SELECT 1 FROM thread_messages m2 WHERE m2.thread_id = t.id AND m2.user_id IN  ('${traineeIDs}'))
      GROUP BY t.id
      ORDER BY t.created_at DESC`,
    [],
  );

  return (
    (threads.map((t) => ({
      ...t,
      staff_ids: t.staff_ids.split("|").filter((s: string) => s.length),
    })) as TraineeThread[]) || null
  );
}
