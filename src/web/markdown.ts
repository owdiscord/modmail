import { marked, type TokenizerAndRendererExtension } from "marked";
import { findThreadLogByChannelID } from "../repositories/threads";
import type { DbQuery } from "../db";

const channelsCache: Record<string, { name: string; thread_id: string }> = {};

const smallHeading: TokenizerAndRendererExtension = {
  name: "smallHeading",
  level: "block",
  start(src) {
    return src.match(/^ {0,3}-#[ \t]/m)?.index;
  },
  tokenizer(src) {
    const rule = /^ {0,3}-#[ \t]+(.+?)(?:\n|$)/;
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

const discordTimeBlock: TokenizerAndRendererExtension = {
  name: "discordTimeBlock",
  level: "inline",
  start(src) {
    return src.match(/<t:/)?.index;
  },
  tokenizer(src) {
    const rule = /^<t:(-?\d+)(?::([tTdDfFR]))?>/;
    const match = rule.exec(src);

    if (match) {
      const [raw, timestamp, style = "f"] = match;

      return {
        type: "discordTimeBlock",
        raw,
        timestamp: Number(timestamp),
        style,
      };
    }
  },
  renderer(token) {
    const date = new Date(token.timestamp * 1000);
    const iso = date.toISOString();

    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    let formatted = (() => {
      switch (token.style) {
        case "t":
          return `${date.getHours() % 12}:${date.getMinutes().toString().padStart(2, "0")} ${date.getHours() >= 12 ? "PM" : "AM"}`;
        case "T":
          return `${date.getHours() % 12}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")} ${date.getHours() >= 12 ? "PM" : "AM"}`;
        case "d":
          return `${date.getFullYear()}/${date.getMonth().toString().padStart(2, "0")}/${date.getMonth().toString().padStart(2, "0")}`;
        case "D":
          return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
        case "f":
          return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} ${date.getHours() % 12}:${date.getMinutes().toString().padStart(2, "0")} ${date.getHours() >= 12 ? "PM" : "AM"}`;
        default:
          return date.toISOString();
      }
    })();

    return `<time datetime="${iso}" data-style="${token.style}">${formatted}</time>`;
  },
};

const channelMessageRegexp =
  /^https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/i;
const dmMessageRegxp = /^https:\/\/discord\.com\/channels\/@me\/(\d+)\/(\d+)$/i;

marked.use({
  extensions: [smallHeading, discordTimeBlock],
  walkTokens(token) {
    if (token.type === "link" && token.text === token.href) {
      if (channelMessageRegexp.test(token.href)) {
        token.text = "Channel Message";
        token.tokens = [
          {
            type: "text",
            raw: "Channel Message",
            text: "Channel Message",
          },
        ];
      } else if (dmMessageRegxp.test(token.href)) {
        token.text = "DM Message";
        token.tokens = [
          {
            type: "text",
            raw: "DM Message",
            text: "DM Message",
          },
        ];
      }
    }
  },
});

export async function convertMarkdown(
  db: DbQuery,
  input: string,
): Promise<string> {
  let html = input;
  const regex = /<#(\d+)>/g;
  const channelMatches = [...html.matchAll(regex)];

  // Fetch all channel data in parallel
  const channelPromises = channelMatches.map((match) =>
    findThreadLogByChannelID(db, match[1] || ""),
  );

  for (const promise of channelPromises) {
    try {
      const { channel_id, thread_id, name } = await promise;
      channelsCache[channel_id] = { thread_id, name };
    } catch (_) {}
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
}
