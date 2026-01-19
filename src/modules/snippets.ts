import * as snippets from "../data/snippets";
import { Collection, Events } from "discord.js";
import type { ModuleProps } from "../plugins";
import {
  disableCodeBlocks,
  isStaff,
  messageIsOnInboxServer,
  postSystemMessageWithFallback,
} from "../utils";
import { findByChannelId } from "../data/threads";
import type { Snippet } from "../data/Snippet";
import { parseArguments } from "knub-command-manager";

// const _whitespaceRegex = /\s/;
// const _quoteChars = ["'", '"'];

export default ({ bot, db, config, commands }: ModuleProps) => {
  if (!config.allowSnippets) return;

  function renderSnippet(body: string, args: Array<string>) {
    return body
      .replace(/(?<!\\){\d+}/g, (match) => {
        const index = parseInt(match.slice(1, -1), 10) - 1;
        return args[index] != null ? args[index] : match;
      })
      .replace(/\\{/g, "{");
  }

  /**
   * When a staff member uses a snippet (snippet prefix + trigger word), find the snippet and post it as a reply in the thread
   */
  bot.on(Events.MessageCreate, async (msg) => {
    if (!(await messageIsOnInboxServer(bot, msg))) return;
    if (!isStaff(msg.member)) return;

    if (
      msg.author.bot ||
      !msg.content ||
      !config.snippetPrefixAnon ||
      !config.snippetPrefix
    )
      return;
    if (!msg.content) return;
    if (
      !msg.content.startsWith(config.snippetPrefix) &&
      !msg.content.startsWith(config.snippetPrefixAnon)
    )
      return;

    let snippetPrefix, isAnonymous;

    if (config.snippetPrefixAnon.length > config.snippetPrefix.length) {
      // Anonymous prefix is longer -> check it first
      if (msg.content.startsWith(config.snippetPrefixAnon)) {
        snippetPrefix = config.snippetPrefixAnon;
        isAnonymous = true;
      } else {
        snippetPrefix = config.snippetPrefix;
        isAnonymous = false;
      }
    } else {
      // Regular prefix is longer -> check it first
      if (msg.content.startsWith(config.snippetPrefix)) {
        snippetPrefix = config.snippetPrefix;
        isAnonymous = false;
      } else {
        snippetPrefix = config.snippetPrefixAnon;
        isAnonymous = true;
      }
    }

    if (config.forceAnon) {
      isAnonymous = true;
    }

    const thread = await findByChannelId(db, msg.channel.id);
    if (!thread) return;

    const snippetInvoke = msg.content.slice(snippetPrefix.length);
    if (!snippetInvoke) return;

    const matches = snippetInvoke.match(/(\S+)(?:\s+(.*))?/s);
    if (!matches || matches.length < 2) return;

    let trigger = matches[1];
    let rawArgs = matches[2] || "";
    if (!trigger) return;

    const snippet = await snippets.get(trigger);
    if (!snippet) return;

    let args = (rawArgs ? parseArguments(rawArgs) : []).map((arg) => arg.value);
    const rendered = renderSnippet(snippet.body, args);

    if (!msg.member) return;

    const replied = await thread.replyToUser(
      msg.member,
      rendered,
      new Collection(),
      isAnonymous,
      msg.reference,
    );
    if (replied) msg.delete();
  });

  // Show or add a snippet
  commands.addInboxServerCommand(
    "snippet",
    "<trigger> [text$]",
    async (msg, args, thread) => {
      const snippet = await snippets.get(args.trigger as string);
      if (!thread || !msg.channel.isSendable()) return;

      if (snippet) {
        if (args.text) {
          // If the snippet exists and we're trying to create a new one, inform the user the snippet already exists
          postSystemMessageWithFallback(
            msg.channel,
            thread,
            `Snippet "${args.trigger}" already exists! You can edit or delete it with ${config.prefix}edit_snippet and ${config.prefix}delete_snippet respectively.`,
          );
        } else {
          // If the snippet exists and we're NOT trying to create a new one, show info about the existing snippet
          postSystemMessageWithFallback(
            msg.channel,
            thread,
            `\`${config.snippetPrefix}${args.trigger}\` replies with: \`\`\`\n${disableCodeBlocks(snippet.body)}\`\`\``,
          );
        }
      } else {
        if (args.text) {
          // If the snippet doesn't exist and the user wants to create it, create it
          await snippets.add(
            args.trigger as string,
            args.text as string,
            msg.author.id as string,
          );
          postSystemMessageWithFallback(
            msg.channel,
            thread,
            `Snippet "${args.trigger}" created!`,
          );
        } else {
          // If the snippet doesn't exist and the user isn't trying to create it, inform them how to create it
          postSystemMessageWithFallback(
            msg.channel,
            thread,
            `Snippet "${args.trigger}" doesn't exist! You can create it with \`${config.prefix}snippet ${args.trigger} text\``,
          );
        }
      }
    },
    {
      aliases: ["s"],
    },
  );

  commands.addInboxServerCommand(
    "delete_snippet",
    "<trigger>",
    async (msg, args, thread) => {
      if (!msg.channel.isSendable() || !thread) return;

      const snippet = await snippets.get(args.trigger as string);
      if (!snippet) {
        postSystemMessageWithFallback(
          msg.channel,
          thread,
          `Snippet "${args.trigger}" doesn't exist!`,
        );
        return;
      }

      await snippets.del(args.trigger as string);
      postSystemMessageWithFallback(
        msg.channel,
        thread,
        `Snippet "${args.trigger}" deleted!`,
      );
    },
    {
      aliases: ["ds"],
    },
  );

  commands.addInboxServerCommand(
    "edit_snippet",
    "<trigger> <text$>",
    async (msg, args, thread) => {
      if (!msg.channel.isSendable() || !thread) return;

      const trigger = (args.trigger as string) || "";

      const snippet = await snippets.get(trigger);
      if (!snippet) {
        postSystemMessageWithFallback(
          msg.channel,
          thread,
          `Snippet "${trigger}" doesn't exist!`,
        );
        return;
      }

      await snippets.del(trigger);
      await snippets.add(trigger, args.text as string, msg.author.id as string);

      postSystemMessageWithFallback(
        msg.channel,
        thread,
        `Snippet "${args.trigger}" edited!`,
      );
    },
    {
      aliases: ["es"],
    },
  );

  commands.addInboxServerCommand(
    "snippets",
    [],
    async (msg, _args, thread) => {
      const allSnippets = await snippets.all();
      const triggers = allSnippets.map((s: Snippet) => s.trigger);
      triggers.sort();

      if (!msg.channel.isSendable() || !thread) return;

      postSystemMessageWithFallback(
        msg.channel,
        thread,
        `Available snippets (prefix ${config.snippetPrefix}):\n${triggers.join(", ")}`,
      );
    },
    {
      aliases: ["s"],
    },
  );
};
