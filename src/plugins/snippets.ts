import { Collection, type Message } from "discord.js";
import { parseArguments } from "knub-command-manager";
import type { ModmailConfig } from "../config";
import type Thread from "../data/Thread";
import type { DbQuery } from "../db";
import type { ModuleProps } from "../plugins";
import {
  addSnippet,
  allSnippets,
  deleteSnippet,
  getSnippet,
  type Snippet,
} from "../repositories/snippets";
import { disableCodeBlocks, postSystemMessageWithFallback } from "../utils";
import { replyToUser } from "../thread";

export default ({ config, commands, db }: ModuleProps) => {
  if (!config.allowSnippets) return;

  // Show or add a snippet
  commands.addInboxServerCommand(
    "snippet",
    "<trigger> [text$]",
    async (msg, args, thread) => {
      const snippet = await getSnippet(db, args.trigger as string);
      if (!msg.channel.isSendable()) return;

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
          await addSnippet(
            db,
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
      if (!msg.channel.isSendable()) return;

      const snippet = await getSnippet(db, args.trigger as string);
      if (!snippet) {
        postSystemMessageWithFallback(
          msg.channel,
          thread,
          `Snippet "${args.trigger}" doesn't exist!`,
        );
        return;
      }

      await deleteSnippet(db, args.trigger as string);
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
      if (!msg.channel.isSendable()) return;

      const trigger = (args.trigger as string) || "";

      const snippet = await getSnippet(db, trigger);
      if (!snippet) {
        postSystemMessageWithFallback(
          msg.channel,
          thread,
          `Snippet "${trigger}" doesn't exist!`,
        );
        return;
      }

      await deleteSnippet(db, trigger);
      await addSnippet(
        db,
        trigger,
        args.text as string,
        msg.author.id as string,
      );

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
      const all = await allSnippets(db);
      const triggers = all.map((s: Snippet) => s.trigger);
      triggers.sort();

      if (!msg.channel.isSendable()) return;

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

export async function handleSnippet(
  db: DbQuery,
  msg: Message,
  config: ModmailConfig,
  thread: Thread,
  anon: boolean,
) {
  const snippetInvoke = msg.content.slice(
    anon ? config.anonSnippetPrefix.length : config.snippetPrefix.length,
  );
  if (!snippetInvoke) return;

  const matches = snippetInvoke.match(/(\S+)(?:\s+(.*))?/s);
  if (!matches || matches.length < 2) return;

  const trigger = matches[1];
  const rawArgs = matches[2] || "";
  if (!trigger) return;

  const snippet = await getSnippet(db, trigger);
  if (!snippet) return;

  const args = (rawArgs ? parseArguments(rawArgs) : []).map((arg) => arg.value);

  const renderSnippet = (body: string, args: Array<string>) =>
    body
      .replace(/(?<!\\){\d+}/g, (match) => {
        const index = parseInt(match.slice(1, -1), 10) - 1;
        return args[index] != null ? args[index] : match;
      })
      .replace(/\\{/g, "{");

  const rendered = renderSnippet(snippet.body, args);

  if (!msg.member) return;

  const replied = await replyToUser(
    db,
    thread,
    msg.member,
    rendered,
    new Collection(),
    anon,
    msg.reference,
  );
  if (replied) msg.delete();
}
