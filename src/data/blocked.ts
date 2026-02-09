import { useDb } from "../db";

const db = useDb();

export async function getBlockStatus(
  user_id: string,
): Promise<{ isBlocked: boolean; expiresAt: string }> {
  const rows =
    await db`SELECT expires_at FROM blocked_users WHERE user_id = ${user_id} LIMIT 1`;

  if (rows.length !== 1)
    return {
      isBlocked: false,
      expiresAt: "",
    };

  return {
    isBlocked: true,
    expiresAt: rows[0].expires_at,
  };
}

export async function isBlocked(userId: string): Promise<boolean> {
  return (await getBlockStatus(userId)).isBlocked;
}

export async function block(
  user_id: string,
  user_name: string = "",
  blocked_by: string = "",
  expires_at: number | null = null,
): Promise<void> {
  if (await isBlocked(user_id)) return;

  const expires_at_micro = expires_at !== null ? expires_at * 1000 : null;

  return await db`INSERT INTO blocked_users
    (user_id, user_name, blocked_by, blocked_at, expires_at) VALUES
    (${user_id}, ${user_name}, ${blocked_by}, now(), CASE
      WHEN ${expires_at} IS NULL THEN NULL
      ELSE DATE_ADD(NOW(), INTERVAL ${expires_at_micro} MICROSECOND)
    END
  )`;
}

export async function unblock(user_id: string): Promise<void> {
  return await db`DELETE FROM blocked_users WHERE user_id = ${user_id}`;
}

export async function updateExpiryTime(
  user_id: string,
  expires_at: number,
): Promise<void> {
  return await db`UPDATE blocked_users SET expires_at = DATE_ADD(NOW(), INTERVAL ${expires_at * 1000} MICROSECOND) WHERE user_id = ${user_id}`;
}

export async function getExpiredBlocks(): Promise<
  Array<{ user_id: string; duration: number }>
> {
  const now = new Date();

  const blockedUsers =
    await db`SELECT user_id, TIMESTAMPDIFF(MICROSECOND, blocked_at, expires_at) / 1000 duration FROM blocked_users WHERE expires_at IS NOT NULL AND expires_at <= ${now}`;

  return blockedUsers.map((block: { user_id: string; duration: number }) => ({
    user_id: block.user_id,
    duration: block.duration,
  }));
}

export async function getBlockedUsers(): Promise<
  Array<{
    userId: string;
    userName: string;
    blockedBy: string;
    blockedAt: string;
    expiresAt: string;
  }>
> {
  const blockedUsers = await db`SELECT * FROM blocked_users`;

  return blockedUsers.map(
    (row: {
      user_id: string;
      user_name: string;
      blocked_by: string;
      blocked_at: Date;
      expires_at: Date;
    }) => ({
      userId: row.user_id,
      userName: row.user_name,
      blockedBy: row.blocked_by,
      blockedAt: row.blocked_at,
      expiresAt: row.expires_at,
    }),
  );
}
