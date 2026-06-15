import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getMimeType } from "hono/utils/mime";
import academy from "./academy";
import config from "./config";
import { getLocalAttachmentPath } from "./data/attachments";
import { formatLog } from "./data/logs";
import type { Thread } from "./data/Thread";
import type { ThreadMessage } from "./data/ThreadMessage";
import { useDb } from "./db";
import { getMessagesInThread } from "./repositories/threadMessages";
import { findThreadByID } from "./repositories/threads";
import { Thread as ThreadView } from "./web/view";

const app = new Hono();

const db = useDb();

app.use(
  secureHeaders({
    crossOriginResourcePolicy: "cross-origin",
  }),
);
app.use(
  cors({
    origin: ["http://localhost:8800", "http://localhost:1234"],
  }),
);

app.route("/academy", academy);

app.get("/style.css", async (_) => {
  const cssFile = await readFile("./src/web/style.css");

  return new Response(cssFile, {
    headers: {
      "Content-Type": "text/css",
    },
  });
});

app.get("/logs/:id", async (c) => {
  const { id } = c.req.param();
  const thread = (await findThreadByID(db, id))[0] as Thread;

  if (!thread) return new Response("Thread not found", { status: 404 });

  const messages = (await getMessagesInThread(db, id)) as ThreadMessage[];

  const params = new URL(c.req.url).searchParams;
  const simple = params.get("simple") !== null;
  const verbose = params.get("verbose") !== null;

  if (c.req.query("new") !== undefined) {
    return c.html(<ThreadView thread={thread} messages={messages} />);
  }

  // if (simple || verbose) {
  const formattedResult = await formatLog(thread, messages, {
    simple,
    verbose,
  });

  const contentType = "text/plain; charset=UTF-8";

  return new Response(formattedResult.content, {
    headers: { "Content-Type": contentType },
  });
});

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

export default {
  ...app,
  port: config.web.port,
};
