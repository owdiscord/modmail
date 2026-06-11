import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getMimeType } from "hono/utils/mime";
import { getLocalAttachmentPath } from "./data/attachments";
import { formatLog } from "./data/logs";
import Thread, { type ThreadProps } from "./data/Thread";
import ThreadMessage, { type ThreadMessageProps } from "./data/ThreadMessage";
import { useDb } from "./db";
import { getMessagesInThread } from "./repositories/threadMessages";
import { findThreadByID } from "./repositories/threads";
import academy from "./web/academy";
import { Thread as ThreadView } from "./web/view";

const app = new Hono();

const db = useDb();

app.use(cors());
app.use(secureHeaders());

app.route("/academy/api", academy);

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
  const thread = new Thread(
    db,
    (await findThreadByID(db, id))[0] as ThreadProps,
  );

  if (!thread) return new Response("Thread not found", { status: 404 });

  const messages = (await getMessagesInThread(db, id)).map(
    (tm: ThreadMessageProps) => new ThreadMessage(tm),
  );

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
  const attachmentFile = await readFile(attachmentPath);

  if (!existsSync(attachmentFile)) return c.notFound();

  const contentType = getMimeType(filename);

  return new Response(attachmentFile, {
    headers: {
      "Content-Type": contentType,
    },
  });
});

export default app;
