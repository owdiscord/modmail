import type { SQL } from "bun";
import { type Client, Events, type Message } from "discord.js";
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

export type CommandHandler = (
  msg: Message,
  args: Record<string | number | symbol, unknown>,
  thread?: Thread,
) => void;

export class Commands {
  public manager: CommandManager<{ msg: Message }>;
  private handlers: Record<number, CommandHandler> = {};
  private aliasMap = new Map();
  private db: SQL;
  private bot: Client;

  constructor(bot: Client) {
    this.bot = bot;
    this.db = useDb();
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

    bot.on(Events.MessageCreate, async (msg: Message) => {
      if (msg.author.bot || msg.author.id === bot.user?.id || !msg.content)
        return;

      const matchedCommand = await this.manager.findMatchingCommand(
        msg.content,
        {
          msg,
        },
      );
      if (!matchedCommand) return;
      if (matchedCommand.error !== undefined) {
        postError(msg.channel, matchedCommand.error);
        return;
      }

      const allArgs: Record<string, unknown> = {};
      for (const [name, arg] of Object.entries(matchedCommand.args)) {
        allArgs[name] = arg.value;
      }
      for (const [name, opt] of Object.entries(matchedCommand.opts)) {
        allArgs[name] = opt.value;
      }

      const handler = this.handlers[matchedCommand.id];
      if (!handler) return;

      handler(msg, allArgs);
    });
  }

  public addGlobalCommand(
    trigger: string | RegExp,
    parameters: TParseableSignature | undefined,
    handler: CommandHandler,
    commandConfig: Record<string, unknown> = {},
  ) {
    const aliases = this.aliasMap.has(trigger)
      ? [...this.aliasMap.get(trigger)]
      : [];
    if (commandConfig.aliases)
      aliases.push(...(commandConfig.aliases as Array<string>));

    const cmd = this.manager.add(trigger, parameters, {
      ...commandConfig,
      aliases,
    });
    this.handlers[cmd.id] = handler;
  }

  public addInboxServerCommand(
    trigger: string | RegExp,
    parameters: TParseableSignature | undefined,
    handler: CommandHandler,
    commandConfig: Record<string, unknown> = {},
  ) {
    const aliases = this.aliasMap.has(trigger)
      ? [...this.aliasMap.get(trigger)]
      : [];
    if (commandConfig.aliases)
      aliases.push(...(commandConfig.aliases as Array<string>));

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

    this.handlers[cmd.id] = async (
      msg: Message,
      args: Record<string, unknown>,
    ) => {
      const thread = await findOpenThreadByChannelId(this.db, msg.channel.id);
      handler(msg, args, thread || undefined);
    };
  }

  public addInboxThreadCommand(
    trigger: string | RegExp,
    parameters: TParseableSignature | undefined,
    handler: CommandHandler,
    commandConfig: Record<string, unknown> = {},
  ) {
    const aliases = this.aliasMap.has(trigger)
      ? [...this.aliasMap.get(trigger)]
      : [];
    if (commandConfig.aliases)
      aliases.push(...(commandConfig.aliases as Array<string>));

    let thread: null | Thread;

    const cmd = this.manager.add(trigger, parameters, {
      ...commandConfig,
      aliases,
      preFilters: [
        async (_, context) => {
          if (!(await messageIsOnInboxServer(context.msg))) return false;
          if (!isStaff(context.msg.member)) return false;
          if (commandConfig.allowSuspended) {
            thread = await threads.findByChannelId(
              this.db,
              context.msg.channel.id,
            );
          } else {
            thread = await threads.findOpenThreadByChannelId(
              this.db,
              context.msg.channel.id,
            );
          }
          if (!thread) return false;
          return true;
        },
      ],
    });

    this.handlers[cmd.id] = async (
      msg: Message,
      args: Record<string, unknown>,
    ) => {
      handler(msg, args, thread as Thread);
    };
  }

  public addAlias(originalCmd: string, alias: string) {
    if (!this.aliasMap.has(originalCmd)) {
      this.aliasMap.set(originalCmd, new Set());
    }

    this.aliasMap.get(originalCmd).add(alias);
  }
}

export function createCommandManager(bot: Client) {
  return new Commands(bot);
}
