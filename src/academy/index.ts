import { Hono } from "hono";
import { useDb } from "../db";
import type { RowDataPacket } from "mysql2";

const app = new Hono();
const sql = useDb();

app.get("/api/trainees", (c) => {
  return c.json([]);
});

app.get("/api/config", (c) => {
  return c.json({});
});

app.get("/api/questions", async (c) => {
  const questions = (
    await sql<
      RowDataPacket & { text: string }
    >`SELECT text FROM academy_interview_questions ORDER BY id ASC`
  ).map((q) => q.text);
  return c.json(questions);
});

app.get("/api/auth/redirect", (c) => {
  return c.json([]);
});

app.get("/api/auth/callback", (c) => {
  return c.json([]);
});

app.get("/api/auth/me", (c) => {
  return c.json({
    id: "204084691425427466",
    username: "graphiteisaac",
    display_name: "Isaac",
    avatar_url:
      "https://cdn.discordapp.com/guilds/94882524378968064/users/204084691425427466/avatars/98bdb0a9854cc0da563f51b6a300a98b.png?size=512",
    role: "admin",
  });
});

app.get("/api/threads", async (c) => {
  const threads = await sql`SELECT
      t.user_name,
      t.user_id,
      t.id,
      UNIX_TIMESTAMP(t.created_at) AS created_at,
      CASE t.status
        WHEN 1 THEN 'open'
        WHEN 2 THEN 'closed'
        ELSE 'unknown'
      END as status,
      COUNT(CASE WHEN m.message_type = 2 THEN 1 END) as chat_count,
      COUNT(CASE WHEN m.message_type = 3 THEN 1 END) as from_user_count,
      COUNT(CASE WHEN m.message_type = 4 THEN 1 END) as to_user_count,
      GROUP_CONCAT(DISTINCT m.user_id ORDER BY m.user_id SEPARATOR '|') AS staff_ids
    FROM threads t
      LEFT JOIN thread_messages m ON m.thread_id = t.id
      WHERE t.status < 3
      GROUP BY t.id
      ORDER BY t.created_at DESC`;

  return c.json(
    threads.map((t) => ({
      ...t,
      staff_ids: t.staff_ids.split("|").filter((id: string) => id.length),
    })),
  );
});

app.get("/api/threads/:id", (c) => {
  return c.json({});
});

app.get("/api/cases", (c) => {
  return c.json([]);
});

app.get("/api/cases/:id", (c) => {
  return c.json({});
});

app.get("/api/issues", (c) => {
  return c.json([]);
});

export default app;
