import { Hono } from "hono";
import { cors } from "hono/cors";
import { marked } from "marked";
import type { RowDataPacket } from "mysql2";
import { useDb } from "../db";

const app = new Hono();
const sql = useDb();

app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:1234", "http://localhost:8800"],
    allowHeaders: ["X-Custom-Header", "Upgrade-Insecure-Requests"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
    maxAge: 600,
    credentials: true,
  }),
);

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

app.get("/api/avatar/:snowflake", async (c) => {
  const { snowflake } = c.req.param();

  // FIXME: this sucks? this is bad?
  const user =
    await sql`SELECT avatar FROM academy_staff WHERE snowflake = ${snowflake}`; // TODO: AND wave_id = :wave
  if (!user[0]) return c.notFound();

  return c.notFound();
  // return proxy(user[0].avatar);
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
      COUNT(CASE WHEN m.message_type = 3 THEN 1 END) as reply_messages,
      COUNT(CASE WHEN m.message_type = 4 THEN 1 END) as user_messages,
      COUNT(CASE WHEN m.message_type = 2 THEN 1 END) as internal_messages,
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

app.get("/api/threads/:id", async (c) => {
  const { id } = c.req.param();

  const thread = (
    await sql`SELECT
      t.user_name,
      t.user_id,
      t.id,
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
      WHERE t.id = ${id}
      GROUP BY t.id
      ORDER BY t.created_at DESC`
  )[0];

  if (!thread) return c.notFound();

  const messages = await sql`SELECT
      id,
      message_type,
      IF(is_anonymous = 1, true, false) AS anonymous,
      role_name,
      user_id,
      user_name,
      UNIX_TIMESTAMP(created_at) as created_at,
      body,
      metadata,
      attachments
    FROM thread_messages WHERE thread_id = ${id} ORDER BY created_at ASC`;

  return c.json({
    ...thread,
    staff_ids: thread.staff_ids.split("|").filter((id: string) => id.length),
    messages: messages.map((m) => ({ ...m, body: marked.parse(m.body) })),
  });
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
