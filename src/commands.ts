import type { SQL } from "bun";
import type { Client, Message } from "discord.js";
import {
  CommandManager,
  defaultParameterTypes,
  type TParseableSignature,
  TypeConversionError,
} from "knub-command-manager";
import config from "./config";
import type Thread from "./data/Thread";
import * as threads from "./data/threads";
import { findOpenThreadByChannelId } from "./data/threads";
import { useDb } from "./db";
import {
  getUserMention,
  isStaff,
  messageIsOnInboxServer,
  postError,
} from "./utils";
import { convertDelayStringToMS } from "./utils/time";

const prefix = config.prefix || "!";

export type InboxCommandHandler = (
  msg: Message,
  args: Record<string | number | symbol, unknown>,
  thread?: Thread,
) => void | Promise<void>;

export type ThreadCommandHandler = (
  msg: Message,
  args: Record<string | number | symbol, unknown>,
  thread: Thread,
) => void | Promise<void>;

export type GlobalCommandHandler = (
  msg: Message,
  args: Record<string | number | symbol, unknown>,
) => void | Promise<void>;

export type CommandContext = "thread" | "inbox" | "global";

type HandlerRegistry = {
  inbox: Map<number, InboxCommandHandler>;
  thread: Map<number, ThreadCommandHandler>;
  global: Map<number, GlobalCommandHandler>;
};

export class Commands {
  public manager: CommandManager<{ msg: Message }>;
  private handlers: HandlerRegistry;
  private aliasMap = new Map<string, Set<string>>();
  private db: SQL;
  private bot: Client;

  constructor(bot: Client) {
    this.bot = bot;
    this.db = useDb();
    this.handlers = {
      inbox: new Map(),
      thread: new Map(),
      global: new Map(),
    };

    this.manager = new CommandManager<{ msg: Message }>({
      prefix,
      types: Object.assign({}, defaultParameterTypes, {
        userId(value: string) {
          const userId = getUserMention(value);
          if (!userId) throw new TypeConversionError();
          return userId;
        },
        delay(value: string) {
          const ms = convertDelayStringToMS(value);
          if (ms === null) throw new TypeConversionError();
          return ms;
        },
      }),
    });
  }

  public async handleCommand(
    msg: Message,
    context: CommandContext,
  ): Promise<null | string> {
    if (msg.author.bot || msg.author.id === this.bot.user?.id || !msg.content)
      return null;

    const matchedCommand = await this.manager.findMatchingCommand(msg.content, {
      msg,
    });

    if (!matchedCommand) return "no command was matched";
    if (matchedCommand.error !== undefined) {
      return matchedCommand.error;
      // postError(msg.channel, matchedCommand.error);
      // return;
    }

    const allArgs: Record<string, unknown> = {};
    for (const [name, arg] of Object.entries(matchedCommand.args))
      allArgs[name] = arg.value;

    for (const [name, opt] of Object.entries(matchedCommand.opts))
      allArgs[name] = opt.value;

    // For thread context, we know thread exists due to preFilter
    // For inbox context, thread might not exist
    // For global context, no thread parameter
    if (context === "thread") {
      const handler = this.handlers.thread.get(matchedCommand.id);
      if (!handler) return null;

      // Thread is guaranteed to exist because of preFilter
      const thread = await findOpenThreadByChannelId(this.db, msg.channel.id);
      if (!thread) return null; // Safety check (should never happen)
      await handler(msg, allArgs, thread);
    } else if (context === "inbox") {
      const handler = this.handlers.inbox.get(matchedCommand.id);
      if (!handler) return null;

      const thread = await findOpenThreadByChannelId(this.db, msg.channel.id);
      await handler(msg, allArgs, thread === null ? undefined : thread);
    } else {
      const handler = this.handlers.global.get(matchedCommand.id);
      if (!handler) return null;

      await handler(msg, allArgs);
    }

    return null;
  }

  public addGlobalCommand(
    trigger: string | RegExp,
    parameters: TParseableSignature | undefined,
    handler: GlobalCommandHandler,
    commandConfig: Record<string, unknown> = {},
  ) {
    const aliases = this.getAliases(trigger, commandConfig);

    const cmd = this.manager.add(trigger, parameters, {
      ...commandConfig,
      aliases,
    });

    this.handlers.global.set(cmd.id, handler);
  }

  public addInboxServerCommand(
    trigger: string | RegExp,
    parameters: TParseableSignature | undefined,
    handler: InboxCommandHandler,
    commandConfig: Record<string, unknown> = {},
  ) {
    const aliases = this.getAliases(trigger, commandConfig);

    const cmd = this.manager.add(trigger, parameters, {
      ...commandConfig,
      aliases,
      preFilters: [
        async (_, context) => {
          if (!(await messageIsOnInboxServer(context.msg))) return false;
          if (!isStaff(context.msg.member)) return false;
          return true;
        },
      ],
    });

    this.handlers.inbox.set(cmd.id, handler);
  }

  public addInboxThreadCommand(
    trigger: string | RegExp,
    parameters: TParseableSignature | undefined,
    handler: ThreadCommandHandler, // Now properly typed to require Thread
    commandConfig: Record<string, unknown> = {},
  ) {
    const aliases = this.getAliases(trigger, commandConfig);

    const cmd = this.manager.add(trigger, parameters, {
      ...commandConfig,
      aliases,
      preFilters: [
        async (_, context) => {
          if (!(await messageIsOnInboxServer(context.msg))) return false;
          if (!isStaff(context.msg.member)) return false;

          // Check if thread exists
          const thread = (commandConfig.allowSuspended as boolean)
            ? await threads.findByChannelId(this.db, context.msg.channel.id)
            : await threads.findOpenThreadByChannelId(
                this.db,
                context.msg.channel.id,
              );

          // Reject if no thread found
          if (!thread) return false;
          return true;
        },
      ],
    });

    this.handlers.thread.set(cmd.id, handler);
  }

  public addAlias(originalCmd: string, alias: string) {
    if (!this.aliasMap.has(originalCmd)) {
      this.aliasMap.set(originalCmd, new Set());
    }

    this.aliasMap.get(originalCmd)?.add(alias);
  }

  private getAliases(
    trigger: string | RegExp,
    commandConfig: Record<string, unknown>,
  ): string[] {
    const triggerKey = trigger.toString();
    const aliases = this.aliasMap.has(triggerKey)
      ? [...(this.aliasMap.get(triggerKey) || [])]
      : [];

    if (commandConfig.aliases && Array.isArray(commandConfig.aliases)) {
      aliases.push(...commandConfig.aliases);
    }

    return aliases;
  }
}

export function createCommandManager(bot: Client) {
  return new Commands(bot);
}
