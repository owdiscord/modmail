import config from "../config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { marked } from "marked";
import type { RowDataPacket } from "mysql2";
import { useDb } from "../db";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { proxy } from "hono/proxy";
import { getCookie, setCookie } from "hono/cookie";
import {
  createSession,
  getCachedSession,
  getSessionByID,
  setCachedSession,
  latestUserForDiscordID,
  type Session,
  getUserDetails,
  getSessionByToken,
} from "../repositories/academy/auth";
import logger from "../logger";
import { createMiddleware } from "hono/factory";
import { getWaveDetails } from "../repositories/academy/waves";
import { getWaveThreads } from "../repositories/academy/threads";

const app = new Hono<{ Variables: { session: Session; session_id: string } }>();
const sql = useDb();

const sessionCookie = "academy_session";

const authMiddleware = createMiddleware(async (c, next) => {
  const sessionToken = getCookie(c, sessionCookie);

  if (!sessionToken) {
    logger.debug("no session ID provided");
    return c.json(
      {
        error: "no authentication provided",
      },
      401,
    );
  }

  c.set("session_id", sessionToken);

  const cached = getCachedSession(sessionToken);
  if (cached) {
    c.set("session", cached);
    return await next();
  }

  const inDB = await getSessionByToken(sql, sessionToken);
  if (inDB) {
    setCachedSession(sessionToken, inDB);
    c.set("session", inDB);
    return await next();
  }

  logger.debug({ cached, inDB }, "nothing in db or cache");
  return c.json(
    {
      error: "no authentication provided",
    },
    401,
  );
});

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

app.get("/api/auth/redirect", (c) => {
  const url = `https://discord.com/oauth2/authorize?client_id=${config.secrets.client_id}&response_type=code&redirect_uri=${encodeURIComponent(config.secrets.redirect_uri)}&scope=identify`;
  return c.redirect(url);
});

app.get("/api/auth/callback", async (c) => {
  const code = c.req.query("code");

  if (!code || code.length < 10)
    return c.json({ error: "no code provided" }, 401);

  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", config.secrets.client_id);
  params.set("client_secret", config.secrets.client_secret);
  params.set("code", code);
  params.set("scope", "identify");
  params.set("redirect_uri", config.secrets.redirect_uri);

  const authRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    body: params,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!authRes.ok) {
    console.error({
      params: {
        id: config.secrets.client_id,
        code,
        scope: "identify",
        redirect_uri: config.secrets.redirect_uri,
      },
      response: authRes,
      body: await authRes.text(),
    });
    return c.json({ error: "could not retrieve your discord token" }, 401);
  }

  const { access_token } = (await authRes.json()) as { access_token: string };

  const meRes = await fetch("https://discord.com/api/v10/users/@me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });

  if (!meRes.ok) {
    console.error({
      response: meRes,
      body: await meRes.text(),
    });
    return c.json(
      {
        error:
          "could not retrieve your discord account details, despite getting a token successfully.",
      },
      500,
    );
  }

  const { id: discordID, global_name } = (await meRes.json()) as {
    id: string;
    global_name: string;
  };

  const user = await latestUserForDiscordID(sql, discordID);
  if (!user) {
    logger.warn(
      { discordID, global_name, req: c.req },
      "an unknown user tried to access academy",
    );

    return c.json(
      { error: "You are not authorized to access this page." },
      401,
    );
  }

  const session = await createSession(sql, user.id, user.wave_id);
  if (!session) {
    logger.error(
      { discordID, user_id: user.id, wave: user.wave_id },
      "failed to create session",
    );

    return c.json({ error: "Failed to create this session." }, 401);
  }

  // Cache the session
  setCachedSession(session.token, {
    user_id: user.id,
    wave_id: user.wave_id,
    role: user.role,
    expires_at: session.expires.getTime(),
  });

  // Set the session ID cookie
  setCookie(c, sessionCookie, session.token, {
    httpOnly: true,
    secure: !process.env.DEV_SERVER,
    sameSite: "Lax",
    expires: session.expires,
    path: "/",
  });

  return c.redirect("/academy");
});

app.get("/api/auth/me", authMiddleware, async (c) => {
  const { user_id, wave_id } = c.get("session");
  try {
    const res = await getUserDetails(sql, user_id, wave_id);
    return c.json(res);
  } catch (e) {
    logger.error(e);
    return c.json({ error: "user not found" }, 404);
  }
});

app.get("/api/wave", authMiddleware, async (c) => {
  const { wave_id } = c.get("session");

  try {
    const details = await getWaveDetails(sql, wave_id);
    return c.json(details);
  } catch (e) {
    logger.error(e);
    return c.json({ error: "wave details not found" }, 404);
  }
});

app.get("/api/questions", async (c) => {
  const questions = (
    await sql<
      RowDataPacket & { text: string }
    >`SELECT text FROM academy_interview_questions ORDER BY id ASC`
  ).map((q) => q.text);
  return c.json(questions);
});

app.get("/api/avatar/:snowflake", async (c) => {
  let { snowflake } = c.req.param();
  snowflake = snowflake.substring(0, snowflake.lastIndexOf(".")) || snowflake;

  try {
    const filePath = join(
      import.meta.dirname,
      `../../avatars/${snowflake}.png`,
    );
    const fileStat = await stat(filePath);

    c.header("Content-Type", "image/png");
    c.header("Content-Length", fileStat.size.toString());

    return stream(c, async (target) => {
      const fileStream = createReadStream(filePath);

      await target.pipe(Readable.toWeb(fileStream));
    });
  } catch (e) {
    return stream(c, async (target) => {
      c.header("Content-Type", "image/png");
      c.header("Content-Length", "39464");

      const fileStream = createReadStream(
        join(import.meta.dirname, `../../avatars/default.png`),
      );

      await target.pipe(Readable.toWeb(fileStream));
    });
  }
});

app.get("/api/threads", authMiddleware, async (c) => {
  const { wave_id } = c.get("session");
  const threads = await getWaveThreads(sql, wave_id);

  return c.json(threads);

  // const threads = await sql`SELECT
  //     t.user_name,
  //     t.user_id,
  //     t.id,
  //     UNIX_TIMESTAMP(t.created_at) AS created_at,
  //     CASE t.status
  //       WHEN 1 THEN 'open'
  //       WHEN 2 THEN 'closed'
  //       ELSE 'unknown'
  //     END as status,
  //     COUNT(CASE WHEN m.message_type = 3 THEN 1 END) as reply_messages,
  //     COUNT(CASE WHEN m.message_type = 4 THEN 1 END) as user_messages,
  //     COUNT(CASE WHEN m.message_type = 2 THEN 1 END) as internal_messages,
  //     GROUP_CONCAT(DISTINCT m.user_id ORDER BY m.user_id SEPARATOR '|') AS staff_ids
  //   FROM threads t
  //     LEFT JOIN thread_messages m ON m.thread_id = t.id
  //     WHERE t.status < 3
  //     GROUP BY t.id
  //     ORDER BY t.created_at DESC`;
  //
  // return c.json(
  //   threads.map((t) => ({
  //     ...t,
  //     staff_ids: t.staff_ids.split("|").filter((id: string) => id.length),
  //   })),
  // );
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

app.get("/api/*", (c) => {
  return c.notFound();
});

app.get("*", (c) => {
  // Proxy to a local dev server if DEV_SERVER is true
  if (process.env.DEV_SERVER) return proxy("http://localhost:1234");

  return c.text(`TODO: Serve actual HTML `);
});

export default app;
