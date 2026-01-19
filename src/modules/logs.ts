import * as threads from "../data/threads";
import { utc } from "moment";
import { chunk } from "../utils";
import { getLogUrl, getLogFile, saveLogToStorage } from "../data/logs";
import { ThreadStatus } from "../data/constants";
import { getOrFetchChannel } from "../utils";
import type { Message } from "discord.js";
import type Thread from "../data/Thread";
import type { ModuleProps } from "../plugins";

const LOG_LINES_PER_PAGE = 10;

export default ({ bot, db, config, commands, hooks }: ModuleProps) => {
  const addOptQueryStringToUrl = (
    url: string,
    args: { verbose: boolean; simple: boolean },
  ) => {
    const params = [];
    if (args.verbose) params.push("verbose=1");
    if (args.simple) params.push("simple=1");

    if (params.length === 0) {
      return url;
    }

    const hasQueryString = url.indexOf("?") > -1;
    return url + (hasQueryString ? "&" : "?") + params.join("&");
  };

  const logsCmd = async (
    msg: Message,
    args: Record<string, any>,
    thread?: Thread,
  ) => {
    const userId = args.userId || thread?.user_id;
    if (!userId) return;

    const channel = await getOrFetchChannel(bot, msg.channel.id);
    let userThreads = await threads.getClosedThreadsByUserId(db, userId);

    // Descending by date
    userThreads.sort((a, b) => {
      if (a.created_at > b.created_at) return -1;
      if (a.created_at < b.created_at) return 1;
      return 0;
    });

    // Pagination
    const totalUserThreads = userThreads.length;
    const maxPage = Math.ceil(totalUserThreads / LOG_LINES_PER_PAGE);
    const inputPage = args.page;
    const page = Math.max(
      Math.min(inputPage ? parseInt(inputPage, 10) : 1, maxPage),
      1,
    ); // Clamp page to 1-<max page>
    const isPaginated = totalUserThreads > LOG_LINES_PER_PAGE;
    const start = (page - 1) * LOG_LINES_PER_PAGE;
    const end = page * LOG_LINES_PER_PAGE;
    userThreads = userThreads.slice(
      (page - 1) * LOG_LINES_PER_PAGE,
      page * LOG_LINES_PER_PAGE,
    );

    const threadLines = await Promise.all(
      userThreads.map(async (userThread) => {
        const logUrl = await getLogUrl(userThread);
        const formattedLogUrl = logUrl
          ? `<${addOptQueryStringToUrl(logUrl, { verbose: args.verbose || false, simple: args.simple || false })}>`
          : `View log with \`${config.prefix}log ${userThread.thread_number}\``;

        const formattedDate = `<t:${Math.round(userThread.created_at.getTime() / 1000)}:S>`;
        return logUrl
          ? `• [Thread #${userThread.thread_number || 67}](${formattedLogUrl}) at ${formattedDate}`
          : `• Thread #${userThread.thread_number || 67} - use \`${config.prefix}log ${userThread.thread_number}\` at ${formattedDate}`;
      }),
    );

    let message = isPaginated
      ? `**Log files for <@${userId}>**\n-# Page **${page}/${maxPage}**, showing logs **${start + 1}-${end}/${totalUserThreads}**):`
      : `**Log files for <@${userId}>:**`;

    message += `\n${threadLines.join("\n")}`;

    if (isPaginated) {
      message += "\nTo view more, add a page number to the end of the command";
    }

    if (threadLines.length === 0)
      message = `**There are no log files for <@${userId}>**`;

    // Send the list of logs in chunks of 15 lines per message
    const lines = message.split("\n");
    const chunks = chunk(lines, 15);

    let root = Promise.resolve();
    chunks.forEach((chunkLines) => {
      root = root.then(() => channel.send(chunkLines.join("\n")));
    });
  };

  const logCmd = async (
    msg: Message,
    args: Record<string, unknown>,
    _thread?: Thread,
  ) => {
    const threadId = args.threadId || _thread?.id;
    if (!threadId) return;

    const thread =
      (await threads.findById(db, threadId as string)) ||
      (await threads.findByThreadNumber(db, threadId as number));
    if (!thread) return;

    const channel = await getOrFetchChannel(bot, msg.channel.id);

    // const customResponse = await getLogCustomResponse(thread);
    // if (customResponse && (customResponse.content || customResponse.file)) {
    //   channel.createMessage(customResponse.content, customResponse.file);
    // }

    const logUrl = await getLogUrl(thread);
    if (logUrl) {
      const qs = { verbose: false, simple: false };

      if (args.simple && typeof args.simple === "boolean")
        qs.simple = args.simple;

      if (args.verbose && typeof args.verbose === "boolean")
        qs.verbose = args.verbose;

      channel.send(
        `Open the following link to view the log for thread #${thread.thread_number}:\n<${addOptQueryStringToUrl(logUrl, qs)}>`,
      );
      return;
    }

    const logFile = await getLogFile(thread);
    if (logFile) {
      channel.send({
        content: `Download the following file to view the log for thread #${thread.thread_number}:`,
        files: [logFile],
      });
      return;
    }

    if (thread.status === ThreadStatus.Open) {
      channel.send(
        `This thread's logs are not currently available, but it's open at <#${thread.channel_id}>`,
      );
      return;
    }

    channel.send("This thread's logs are not currently available");
  };

  const logCmdOptions = [
    { name: "verbose", shortcut: "v", isSwitch: true },
    { name: "simple", shortcut: "s", isSwitch: true },
  ];

  commands.addInboxServerCommand(
    "logs",
    "<userId:userId> [page:number]",
    logsCmd,
    { options: logCmdOptions },
  );
  commands.addInboxServerCommand("logs", "[page:number]", logsCmd, {
    options: logCmdOptions,
  });

  // Add these two overrides to allow using the command in suspended threads
  commands.addInboxThreadCommand("log", "", logCmd, {
    options: logCmdOptions,
    aliases: ["thread"],
    allowSuspended: true,
  });
  commands.addInboxThreadCommand("loglink", "", logCmd, {
    options: logCmdOptions,
    allowSuspended: true,
  });

  commands.addInboxServerCommand("log", "<threadId:string>", logCmd, {
    options: logCmdOptions,
    aliases: ["thread"],
  });
  commands.addInboxServerCommand("loglink", "<threadId:string>", logCmd, {
    options: logCmdOptions,
  });

  hooks.afterThreadClose(async ({ threadId }) => {
    const thread = await threads.findById(db, threadId);
    if (thread) await saveLogToStorage(thread);
  });
};
