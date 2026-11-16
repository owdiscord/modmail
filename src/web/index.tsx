import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getMimeType } from "hono/utils/mime";
import config from "../config";
import { getLocalAttachmentPath } from "../data/attachments";
import { formatLog } from "../data/logs";
import type { Thread } from "../data/Thread";
import type { ThreadMessage } from "../data/ThreadMessage";
import { useDb } from "../db";
import { getMessagesInThread } from "../repositories/threadMessages";
import { findThreadByID } from "../repositories/threads";
import { Thread as ThreadView } from "./views/Thread";
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import logger from '../logger'
import { PrivacyPolicy } from "./views/PrivacyPolicy";
import { createHash } from "node:crypto";

const app = new Hono();

const db = useDb();

app.use(
  secureHeaders({
    crossOriginResourcePolicy: "cross-origin",
  }),
);
app.use(
  cors({
    origin: [
      "http://localhost:8800",
      "http://localhost:1234",
      "https://modmail.owdiscord.org",
    ],
  }),
);

app.onError((err, c) => {
  console.error(err.stack)
  logger.error({ message: err.message }, 'HTTP error')
  return c.json({ error: `${err}` }, 500)
})

app.get("/privacy-policy", (c) => {
  return c.html(<PrivacyPolicy />)
})

const prod = process.env.NODE_ENV === "production"
const css = await readFile(
  prod ? "style.css" : new URL("./style.css", import.meta.url),
);

export const cssHash = prod
  ? createHash("sha256").update(css).digest("hex").slice(0, 8)
  : String(Date.now());

app.get("/logs/style.css", async (_) => new Response(css, {
  headers: {
    "Content-Type": "text/css",
    "Cache-Control": prod
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  },
}));

app.get("/logs/:id", async (c) => {
  const { id } = c.req.param();
  const thread = (await findThreadByID(db, id))[0] as Thread;

  if (!thread) return new Response("Thread not found", { status: 404 });

  const messages = (await getMessagesInThread(db, id)) as ThreadMessage[];

  const params = new URL(c.req.url).searchParams;
  const simple = params.get("simple") !== null;
  const verbose = params.get("verbose") !== null;

  if (c.req.query("old") !== undefined) {
    const formattedResult = await formatLog(thread, messages, {
      simple,
      verbose,
    });

    const contentType = "text/plain; charset=UTF-8";

    return new Response(formattedResult.content, {
      headers: { "Content-Type": contentType },
    });
  }

  return c.html(<ThreadView cssHash={cssHash} thread={thread} messages={messages} />);
});

app.get("/avatar/:snowflake", (c) => {
  const param = c.req.param().snowflake as string
  const snowflake = param.endsWith('.png') ? param.substring(0, param.length - 4) : param
  try {
    const filePath = process.env.NODE_ENV === "production" ? `avatars/${snowflake}.png` : new URL(`../../avatars/${snowflake}.png`, import.meta.url)
    const stat = statSync(filePath)
    const nodeStream = createReadStream(filePath)

    // Convert Node.js stream to a Web Standard ReadableStream
    const webStream = Readable.toWeb(nodeStream) as ReadableStream

    c.header('Content-Type', 'image/png')
    c.header('Content-Length', stat.size.toString())
    c.header('Content-Disposition', 'inline')

    return c.body(webStream)
  } catch (e) {
    return c.text('Not found', 404)
  }
})

app.get("/attachments/:id/:filename", async (c) => {
  const { id, filename } = c.req.param();

  if (!/^[0-9]+$/.test(id) || !/^[0-9a-z._-]+$/i.test(filename))
    return c.text("One or more parameters were malformed.");

  const attachmentPath = getLocalAttachmentPath(id);
  try {
    const attachmentFile = await readFile(attachmentPath);

    if (!attachmentFile) return c.notFound();

    const contentType = getMimeType(filename);

    c.header("Content-Type", contentType);
    c.header("Cross-Origin-Resource-Policy", "cross-origin");

    return c.body(attachmentFile);
  } catch (_e) {
    return c.notFound();
  }
});

const staticPath =
  process.env.NODE_ENV === "production"
    ? "static"
    : path.join(import.meta.dirname, ".../../../../", "static");

app.use(
  "/static/*",
  serveStatic({
    root: staticPath,
    rewriteRequestPath: (path) => path.replace(/^\/static/, "/"),
  }),
);

export default serve({
  ...app,
  port: config.web.port,
})
