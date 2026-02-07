import type { Embed } from "discord.js";
import type { FC } from "hono/jsx";
import { marked, type TokenizerAndRendererExtension } from "marked";
import { ThreadMessageType } from "../data/constants";
import type { Thread as DBThread } from "../data/Thread";
import type { ThreadMessage as DBThreadMessage } from "../data/ThreadMessage";
import { findThreadLogByChannelID } from "../data/threads";
import { useDb } from "../db";
import { getRegisteredUsername, getStaffUsername } from "../data/Registration";

const db = useDb();

const smallHeading: TokenizerAndRendererExtension = {
  name: "smallHeading",
  level: "block",
  start(src) {
    return src.match(/^-#/)?.index;
  },
  tokenizer(src) {
    const rule = /^-# +(.+?)(?:\n|$)/;
    const match = rule.exec(src);

    if (match) {
      const token = {
        type: "smallHeading",
        raw: match[0],
        text: (match[1] || "").trim(),
        tokens: [],
      };

      // Process inline tokens (for bold, italic, links, etc.)
      this.lexer.inline(token.text, token.tokens);
      return token;
    }
  },
  renderer(token) {
    const text = this.parser.parseInline(token.tokens || []);
    return `<h6 class="small-heading">${text}</h6>\n`;
  },
};

// Apply the extension
marked.use({ extensions: [smallHeading] });

const channelsCache: Record<string, { name: string; thread_id: string }> = {};

const convertMarkdown = async (input: string): Promise<string> => {
  let html = input;
  const regex = /<#(\d+)>/g;
  const channelMatches = [...html.matchAll(regex)];

  // Fetch all channel data in parallel
  const channelPromises = channelMatches.map((match) =>
    findThreadLogByChannelID(db, match[1] || ""),
  );

  for (const promise of channelPromises) {
    const { channel_id, thread_id, name } = await promise;
    channelsCache[channel_id] = { thread_id, name };
  }

  // Replace each match with the corresponding result
  channelMatches.forEach((match) => {
    const { thread_id, name } = channelsCache[match[1] || ""] || {
      thread_id: "",
      name: "",
    };
    const replacement = `<a href="${thread_id}">#${name}</a>` || match[0]; // Fallback to original if null/undefined
    html = html.replace(match[0], replacement);
  });

  return await marked(html);
};

const Layout: FC = (props) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="/style.css" rel="stylesheet" />
        <title>{props.title}</title>
      </head>
      <body>{props.children}</body>
    </html>
  );
};

export const Thread: FC<{
  thread: DBThread;
  messages: Array<DBThreadMessage>;
}> = async ({ thread, messages }) => {
  // const user = await bot.users.fetch(thread.user_id);
  if (messages.length === 0)
    return (
      <Layout title="error">
        <h1>A fatal error has occurred, there are no messages.</h1>
      </Layout>
    );

  const data = extractData(messages[0]?.body || "");
  const collapsedMessages = collapseThreadMessages(messages.splice(1));

  return (
    <Layout title={`Modmail thread with ${thread.user_name}`}>
      <header class="thread-header">
        <img
          src="https://cdn.discordapp.com/avatars/255432387993796618/5c947997c70c1d3db8b9950db924a25a.png?size=256"
          alt="Modmail Icon"
          width="80px"
        />
        <h1>Thread with {thread.user_name}</h1>
        {/*  TODO: Format creation */}
        <p>
          Thread opened{" "}
          {thread.created_at.toLocaleString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          . When the thread was opened, the user had opened{" "}
          <b>
            {data.previous_threads
              ? `${data.previous_threads} thread${data.previous_threads === 1 ? "" : "s"}`
              : "no"}
          </b>{" "}
          before, and their account was created <b>{data.account_age}</b> ago.
        </p>
        {data.servers.map((server) => (
          <div class="server">
            <h5 class="server-name">
              {server.name}{" "}
              <span class="server-known-as">(as {server.nickname})</span>
            </h5>
            <ul class="server-roles">
              {server.roles.map((role) => (
                <li class="msg-row" data-role={role.toLowerCase()}>
                  {role}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </header>
      <main class="thread">
        {/* <pre>{JSON.stringify(thread, null, 2)}</pre> */}
        <ul class="thread-messages">
          {collapsedMessages.map((msg) => {
            switch (msg.message_type) {
              case ThreadMessageType.System | ThreadMessageType.SystemToUser:
                return <SystemMessage msg={msg} />;
              case ThreadMessageType.FromUser:
                return <UserMessage msg={msg} />;
              case ThreadMessageType.ToUser:
                return <OutgoingMessage msg={msg} />;
              case ThreadMessageType.Chat:
                return <InternalMessage msg={msg} />;
              default:
                return null;
                {
                  /* return <pre>{JSON.stringify(msg, null, 2)}</pre> */
                }
            }
          })}
        </ul>
      </main>
    </Layout>
  );
};

const UserMessage: FC<{ msg: CollapsedThreadMessage }> = async ({ msg }) => {
  return (
    <li class="msg-row" data-message-type="from-user">
      <figure
        class="msg-avatar"
        style="background-image: url('https://cdn.discordapp.com/avatars/255432387993796618/5c947997c70c1d3db8b9950db924a25a.png?size=256')"
      ></figure>
      <div class="msg-content">
        <div class="msg-header">
          <p data-tooltip={msg.user_id}>
            {msg.user_name}
            <UserIcon />
            <span class="typeBadge">{messageType(msg.message_type)}</span>
          </p>
          <time>{msg.created_at.toLocaleString()}</time>
        </div>
        <div class="msg-body">
          {msg.bodies.map(async (body) => (
            <article
              dangerouslySetInnerHTML={{ __html: await convertMarkdown(body) }}
            ></article>
          ))}
          {msg.metadata.embeds && (
            <Embeds embeds={msg.metadata.embeds as Array<Embed>} />
          )}
        </div>
      </div>
    </li>
  );
};

const Embeds: FC<{ embeds: Array<Embed> }> = ({ embeds }) => {
  return (
    <>
      {embeds.map((embed) => {
        return (
          <div
            class="msg-embed"
            style={{ "--embed-color": `#${(embed.color || 0).toString(16)}` }}
          >
            {embed.title && <h4>{embed.title}</h4>}
            {embed.description && <p>desc: {embed.description}</p>}
            <ul>
              {embed.fields.map(async (field) => (
                <li data-inline={field.inline}>
                  <h5>{field.name}</h5>
                  <div
                    dangerouslySetInnerHTML={{
                      __html: await convertMarkdown(field.value),
                    }}
                  ></div>
                </li>
              ))}
            </ul>
            {embed.footer && (
              <footer>
                <p>{embed.footer.text}</p>
              </footer>
            )}
          </div>
        );
      })}
    </>
  );
};

const OutgoingMessage: FC<{ msg: CollapsedThreadMessage }> = async ({ msg }) => {
  const displayName = await getRegisteredUsername(db, msg.user_id) || msg.user_name

  return (
    <li class="msg-row" data-message-type="from-user">
      <figure
        class="msg-avatar"
        style="background-image: url('https://cdn.discordapp.com/avatars/255432387993796618/5c947997c70c1d3db8b9950db924a25a.png?size=256')"
      ></figure>
      <div class="msg-content">
        <div class="msg-header">
          <p data-tooltip={msg.user_id} data-role={msg.role_name.toLowerCase()}>
            {displayName}
            <ShieldIcon />
            <span class="typeBadge">{messageType(msg.message_type)}</span>
          </p>
          <time>{msg.created_at.toLocaleString()}</time>
        </div>
        <div class="msg-body">
          {msg.bodies.map((body) => (
            <p>{body}</p>
          ))}
        </div>
      </div>
    </li>
  );
};

const SystemMessage: FC<{ msg: CollapsedThreadMessage }> = ({ msg }) => {
  return (
    <li
      class="msg-row"
      data-message-type={
        msg.message_type === ThreadMessageType.System
          ? "system"
          : "system-to-user"
      }
    >
      <figure
        class="msg-avatar"
        style="background-image: url('https://cdn.discordapp.com/avatars/255432387993796618/5c947997c70c1d3db8b9950db924a25a.png?size=256')"
      ></figure>
      <div class="msg-content">
        <div class="msg-header">
          <p data-tooltip={msg.user_id}>
            Overwatch ModMail
            <MailIcon />
            <span class="typeBadge">{messageType(msg.message_type)}</span>
          </p>
          <time>{msg.created_at.toLocaleString()}</time>
        </div>
        <div class="msg-body">
          {msg.bodies.map((body) => (
            <p>{body}</p>
          ))}
        </div>
      </div>
    </li>
  );
};

const _ToUser: FC<{ msg: CollapsedThreadMessage }> = ({ msg }) => {
  return (
    <li class="msg-row" data-message-type="to-user">
      <figure class="msg-avatar"></figure>
      <div class="msg-content">
        <div class="msg-header">
          <p data-tooltip={msg.user_id}>
            {msg.user_name}
            <MailIcon />
            <span class="typeBadge">{messageType(msg.message_type)}</span>
          </p>
          <time>{msg.created_at.toLocaleString()}</time>
        </div>
        <div class="msg-body">
          {msg.bodies.map((body) => (
            <p>{body}</p>
          ))}
        </div>
      </div>
    </li>
  );
};

const InternalMessage: FC<{ msg: CollapsedThreadMessage }> = async ({ msg }) => {
  const displayName = await getRegisteredUsername(db, msg.user_id) || msg.user_name

  return (
    <li class="msg-row" data-message-type="internal">
      <figure
        class="msg-avatar"
        style="background-image: url('https://cdn.discordapp.com/guilds/94882524378968064/users/164564849915985922/avatars/5af00b63dec32d3b5f80cf7d2f2a0f0e.png?size=128')"
      ></figure>
      <div class="msg-content">
        <div class="msg-header">
          <p data-tooltip={msg.user_id}>
            {displayName}
            <ShieldIcon />
            <span class="typeBadge">{messageType(msg.message_type)}</span>
          </p>
          <time>{msg.created_at.toLocaleString()}</time>
        </div>
        <div class="msg-body">
          {msg.bodies.map(async (body) => (
            <article
              dangerouslySetInnerHTML={{ __html: await convertMarkdown(body) }}
            ></article>
          ))}
        </div>
      </div>
    </li>
  );
};

const ShieldIcon: FC = (_props) => {
  return (
    <svg
      role="img"
      aria-label="Shield Icon"
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15.3296 0H4.6586C4.49194 2.16758 2.65782 3.83491 0.490234 3.83491V4.8353C0.490234 9.75393 2.82462 14.3392 6.90952 17.5905L9.99416 20.008L13.0787 17.5905C17.1637 14.4224 19.498 9.75393 19.498 4.8353V3.83491C17.3304 3.83491 15.5797 2.16758 15.3296 0ZM8.07671 14.4224C5.57566 12.4216 4.07501 9.58726 4.07501 6.50262V5.91902C5.40887 5.91902 6.57606 4.91863 6.65939 3.58477H9.99416V16.0064L8.07671 14.4224Z" />
    </svg>
  );
};

const UserIcon: FC = (_props) => {
  return (
    <svg
      role="img"
      aria-label="User Icon"
      xmlns="http://www.w3.org/2000/svg"
      class="user-icon"
      viewBox="0 0 640 640"
      fill="currentColor"
    >
      <path d="M64 416L64 192C64 139 107 96 160 96L480 96C533 96 576 139 576 192L576 416C576 469 533 512 480 512L360 512C354.8 512 349.8 513.7 345.6 516.8L230.4 603.2C226.2 606.3 221.2 608 216 608C202.7 608 192 597.3 192 584L192 512L160 512C107 512 64 469 64 416z" />
    </svg>
  );
};

const _CogIcon: FC = (_props) => {
  return (
    <svg
      role="img"
      aria-label="Cog (Gear) Icon"
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M11 2C11.5523 2 12 2.44772 12 3V4.02441C12 4.21445 12.1212 4.38252 12.2969 4.45508C12.4726 4.52762 12.6761 4.49371 12.8105 4.35938L13.5352 3.63574C13.9257 3.24532 14.5587 3.24532 14.9492 3.63574L16.3633 5.0498C16.7538 5.4403 16.7537 6.07334 16.3633 6.46387L15.6396 7.18652C15.5047 7.32131 15.4703 7.52585 15.543 7.70215C15.6157 7.87829 15.785 8 15.9756 8H17C17.5523 8 18 8.44772 18 9V11C18 11.5523 17.5523 12 17 12H15.9746C15.7846 12 15.6165 12.1212 15.5439 12.2969C15.4714 12.4726 15.5052 12.6761 15.6396 12.8105L16.3643 13.5352C16.7547 13.9257 16.7547 14.5587 16.3643 14.9492L14.9502 16.3633C14.5597 16.7538 13.9267 16.7537 13.5361 16.3633L12.8115 15.6387C12.6768 15.5041 12.4728 15.4701 12.2969 15.543C12.1212 15.6158 12.0001 15.7844 12 15.9746V17C12 17.5523 11.5523 18 11 18H9C8.44772 18 8 17.5523 8 17V15.9756C8 15.785 7.87829 15.6157 7.70215 15.543C7.52585 15.4703 7.32131 15.5047 7.18652 15.6396L6.46387 16.3633C6.07334 16.7538 5.44033 16.7538 5.0498 16.3633L3.63574 14.9492C3.24529 14.5587 3.24524 13.9257 3.63574 13.5352L4.36035 12.8105C4.49458 12.6762 4.52813 12.4726 4.45605 12.2969C4.38394 12.1211 4.21535 12 4.02539 12H3C2.44772 12 2 11.5523 2 11V9C2 8.44772 2.44772 8 3 8H4.02441C4.21494 8 4.38368 7.87839 4.45605 7.70215C4.5284 7.52595 4.49483 7.32232 4.36035 7.1875L3.63672 6.46387C3.24619 6.07334 3.24619 5.44033 3.63672 5.0498L5.05078 3.63574C5.44131 3.24529 6.07434 3.24524 6.46484 3.63574L7.18848 4.35938C7.3231 4.49396 7.5271 4.52756 7.70312 4.45508C7.87881 4.38255 7.99995 4.2145 8 4.02441V3C8 2.44772 8.44772 2 9 2H11ZM10 6.5C8.067 6.5 6.5 8.067 6.5 10C6.5 11.933 8.067 13.5 10 13.5C11.933 13.5 13.5 11.933 13.5 10C13.5 8.067 11.933 6.5 10 6.5Z"
      />
    </svg>
  );
};

const MailIcon: FC = (_props) => {
  return (
    <svg
      role="img"
      aria-label="Mail Icon"
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.24503 11.8951L9.26752 11.9132C9.74345 12.2871 10.4286 12.281 10.8977 11.8951L12.2663 10.7694L18.4821 15.882C18.4928 15.8908 18.5002 15.9012 18.5045 15.9123C18.4373 15.967 18.3506 16 18.2559 16H1.88697C1.79225 16 1.7055 15.967 1.63824 15.9122C1.64262 15.9012 1.64998 15.8908 1.66068 15.882L7.87642 10.7694L9.24503 11.8951Z" />
      <path d="M18.6429 14.4894L13.1932 10.0071L18.6429 5.52472V14.4894Z" />
      <path d="M6.9495 10.007L1.5 14.4893V5.52479L6.9495 10.007Z" />
      <path d="M18.2559 4C18.3522 4 18.4402 4.03418 18.5079 4.0906C18.5047 4.10577 18.4964 4.12039 18.4821 4.13217L10.1215 11.0088C10.0926 11.0325 10.0502 11.0326 10.0213 11.0088L1.66068 4.13217C1.64638 4.12039 1.63807 4.10577 1.63484 4.0906C1.70257 4.03416 1.79064 4 1.88697 4H18.2559Z" />
    </svg>
  );
};

const extractData = (
  data: string,
): {
  account_age: string;
  previous_threads: number;
  servers: Array<{
    name: string;
    nickname: string;
    joined: string;
    roles: Array<string>;
  }>;
} => {
  const [userData, ...rest] = data
    .split("\n")
    .filter((c) => c !== "" && c !== "────────────────");
  if (!userData || !rest) throw "Malformed data";

  const account_age = userData.split("**")[1] || "Unknown";

  const { servers, previous_threads } = rest.reduce(
    (accum, line) => {
      if (line.includes("previous")) {
        return {
          servers: accum.servers,
          previous_threads: parseInt(line.split("**")[1] || "0", 10),
        };
      } else {
        const pattern =
          /\*\*\[([^\]]+)\]\*\* NICKNAME \*\*([^*]+)\*\*, JOINED \*\*([^*]+)\*\* ago, ROLES \*\*([^*]+)\*\*/;
        const match = line.match(pattern);

        if (!match) {
          return accum;
        }

        accum.servers.push({
          name: match[1] || "",
          nickname: match[2] || "",
          joined: match[3] || "",
          roles: (match[4] || "")
            .split(", ")
            .map((role) => (role === "Isaac" ? "Muted" : role.trim())),
        });
        return accum;
      }
    },
    {
      servers: [] as Array<{
        name: string;
        nickname: string;
        joined: string;
        roles: Array<string>;
      }>,
      previous_threads: 0,
    },
  );

  return {
    account_age,
    previous_threads,
    servers,
  };
};

const messageType = (type_: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) =>
  ({
    1: "System",
    2: "Internal Chat",
    3: "From User",
    4: "To User",
    5: "Legacy",
    6: "Command",
    7: "System (To User)",
    8: "Reply Edited",
    9: "Reply Deleted",
  })[type_];

interface CollapsedThreadMessage {
  ids: number[];
  thread_id: string;
  message_type: ThreadMessageType;
  message_numbers: number[];
  user_id: string;
  user_name: string;
  role_name: string;
  bodies: string[];
  is_anonymous: boolean;
  attachments: string[];
  small_attachments: string[];
  dm_channel_id: string;
  dm_message_id: string;
  inbox_message_id: string;
  created_at: Date;
  use_legacy_format: boolean;
  metadata: Record<string, unknown>;
}

function collapseThreadMessages(
  messages: DBThreadMessage[],
): CollapsedThreadMessage[] {
  if (messages.length === 0 || !messages[0]) return [];

  const result: CollapsedThreadMessage[] = [];
  let currentGroup: DBThreadMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const current = messages[i];
    const previous = currentGroup[0];
    if (!current || !previous) continue;

    // Check if messages should be grouped together
    const shouldGroup =
      current.message_type === previous.message_type &&
      current.user_id === previous.user_id &&
      current.thread_id === previous.thread_id &&
      current.is_anonymous === previous.is_anonymous &&
      current.role_name === previous.role_name;

    if (shouldGroup) {
      currentGroup.push(current);
    } else {
      // Flush the current group
      result.push(collapseGroup(currentGroup));
      currentGroup = [current];
    }
  }

  // Flush the last group
  result.push(collapseGroup(currentGroup));

  return result;
}

function collapseGroup(group: DBThreadMessage[]): CollapsedThreadMessage {
  if (group.length === 1 && group[0]) {
    return {
      ...group[0],
      ids: [group[0].id],
      message_numbers: [group[0].message_number],
      bodies: [group[0].body],
    };
  }

  const first = group[0];
  if (!first) throw "Fatality";

  return {
    ids: group.map((m) => m.id),
    thread_id: first.thread_id,
    message_type: first.message_type,
    message_numbers: group.map((m) => m.message_number),
    user_id: first.user_id,
    user_name: first.user_name,
    role_name: first.role_name,
    bodies: group.map((m) => m.body),
    is_anonymous: first.is_anonymous,
    attachments: group.flatMap((m) => m.attachments),
    small_attachments: group.flatMap((m) => m.small_attachments),
    dm_channel_id: first.dm_channel_id,
    dm_message_id: first.dm_message_id,
    inbox_message_id: first.inbox_message_id,
    created_at: first.created_at,
    use_legacy_format: first.use_legacy_format,
    metadata: first.metadata, // Using first message's metadata
  };
}
