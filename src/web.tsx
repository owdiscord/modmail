import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getMimeType } from "hono/utils/mime";
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
    origin: [
      "http://localhost:8800",
      "http://localhost:1234",
      "https://modmail.owdiscord.org",
    ],
  }),
);

app.get("/privacy-policy", (c) => {
  return c.html(<html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="X-UA-Compatible" content="ie=edge" />
      <title>ModMail Privacy Policy</title>
      <style>
        {`
        body {
          font-family: -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, Adwaita Sans, Cantarell, Ubuntu, roboto, noto, helvetica, arial, sans-serif;
          margin: 0;
          background-color: #fff;
          color: #0d1117;
        }

        @media (prefers-color-scheme: dark) {
          body {
            background-color: #0d1117;
            color: #fff;
          }
        }

        a {
          color: #f06414;
        }

        article {
          margin: 0 auto;
          max-width: 80ch;
          padding: 2rem 0;
        }
`}
      </style>
    </head>
    <body>
      <article>
        <h1>ModMail Privacy Policy</h1>
        <h2>Bot overview</h2>
        <p>Modmail is a ticketing system that lets users contact server staff through the bot instead of messaging staff members individually or pinging them publicly in the server.</p>
        <p>The bot's source code is available on <a href="https://github.com/owdiscord/modmail">GitHub</a></p>

        <h2>Stored personal data</h2>
        <p>The bot stores full transcripts of modmail threads. These transcripts include:</p>
        <ul>
          <li>User ID, username, nickname, and display name of the contacting or contacted user</li>
          <li>User ID, username, nickname, and display name of any moderators participating in the thread</li>
        </ul>

        <p>In addition, the bot stores:</p>
        <ul>
          <li>User ID and username of users blocked from contacting the bot</li>
          <li>User ID of author and target user of notes saved in the bot</li>
          <li>User ID of the author of snippets saved in the bot</li>
        </ul>

        <h2>Data retention</h2>
        <p>The bot stores full transcripts of modmail threads. These transcripts include:</p>
        <ul>
          <li>Thread transcripts are stored until manually deleted</li>
          <li>User IDs tied to notes are stored until the note is deleted</li>
          <li>User IDs tied to snippets are stored until the snippet is deleted</li>
        </ul>

        <h2>Data access and deleition requests</h2>
        <p>To request access to your data or for your data to be deleted, please contact any member of the <a href="https://owdiscord.com/invite">Overwatch Server</a> Admin team, either via direct message or by messaging the ModMail instance. Alternatively, you can email the maintainer by reversing "caasi", followed by "@grphcrtv.com". This has been obscured to prevent botting; not to discourage regular contact.</p>
        <p style="font-size:.9rem"><em>Last updated 2026-01-06</em></p>
      </article>
    </body>
  </html>)
})

app.get("/logs/style.css", async (_) => {
  const cssFile = await readFile(
    process.env.NODE_ENV === "production" ? "style.css" : "./src/web/style.css",
  );

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
