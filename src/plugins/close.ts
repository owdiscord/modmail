import { DMChannel, Events, GuildChannel } from "discord.js";
import * as blocked from "../data/blocked";
import { ThreadMessageType } from "../data/constants";
import { getLogCustomResponse, getLogFile, getLogUrl } from "../data/logs";
import type Thread from "../data/Thread";
import * as threads from "../data/threads";
import { getThreadsThatShouldBeClosed } from "../data/threads";
import type { ModuleProps } from "../plugins";
import { messageQueue } from "../queue";
import {
  convertDelayStringToMS,
  getInboxGuild,
  humanizeDelay,
  isStaff,
  messageIsOnInboxServer,
  postLog,
  readMultilineConfigValue,
  trimAll,
} from "../utils";

export default ({ bot, config, commands, db }: ModuleProps) => {
  async function getMessagesAmounts(thread: Thread) {
    const messages = await thread.getThreadMessages();
    const chatMessages = [];
    const toUserMessages = [];
    const fromUserMessages = [];

    messages.forEach((message) => {
      switch (message.message_type) {
        case ThreadMessageType.Chat:
          chatMessages.push(message);
          break;

        case ThreadMessageType.ToUser:
          toUserMessages.push(message);
          break;

        case ThreadMessageType.FromUser:
          fromUserMessages.push(message);
          break;
      }
    });

    return [
      `**${fromUserMessages.length}** message${fromUserMessages.length !== 1 ? "s" : ""} from the user`,
      `, **${toUserMessages.length}** message${toUserMessages.length !== 1 ? "s" : ""} to the user`,
      ` and **${chatMessages.length}** internal chat message${chatMessages.length !== 1 ? "s" : ""}.`,
    ].join("");
  }

  async function sendCloseNotification(thread: Thread, body: string) {
    const logCustomResponse = await getLogCustomResponse(thread);
    if (logCustomResponse) {
      postLog(body);
      return;
    }

    body = `${body}\n${await getMessagesAmounts(thread)}`;

    const logUrl = await getLogUrl(thread);
    if (logUrl) {
      postLog(
        trimAll(`
          ${body}
          Logs: ${logUrl}
        `),
      );
      return;
    }

    const logFile = await getLogFile(thread);
    if (logFile) {
      postLog(body, [logFile]);
      return;
    }

    postLog(body);
  }

  // Check for threads that are scheduled to be closed and close them
  async function applyScheduledCloses() {
    const threadsToBeClosed = await getThreadsThatShouldBeClosed(db);

    for (const thread of threadsToBeClosed) {
      if (config.closeMessage && !thread.scheduled_close_silent) {
        const closeMessage = readMultilineConfigValue(config.closeMessage);
        await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
      }

      await thread.close(false, thread.scheduled_close_silent);

      await sendCloseNotification(
        thread,
        `Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) was closed as scheduled by ${thread.scheduled_close_name} (${thread.scheduled_close_id})`,
      );
    }
  }

  async function scheduledCloseLoop() {
    try {
      await applyScheduledCloses();
    } catch (e) {
      console.error(e);
    }

    setTimeout(scheduledCloseLoop, 2000);
  }

  scheduledCloseLoop();

  // Close a thread. Closing a thread saves a log of the channel's contents and then deletes the channel.
  commands.addGlobalCommand(
    "close",
    "[opts...]",
    async (msg, args) => {
      let thread: Thread | null = null;
      let closedBy = "Nobody";

      const hasCloseMessage = !!config.closeMessage;
      let silentClose = false;
      let suppressSystemMessages = false;

      if (msg.channel instanceof DMChannel) {
        // User is closing the thread by themselves (if enabled)
        if (!config.allowUserClose) return;
        if (await blocked.isBlocked(msg.author.id)) return;

        thread = await threads.findOpenThreadByUserId(db, msg.author.id);
        if (!thread) return;

        // We need to add this operation to the message queue so we don't get a race condition
        // between showing the close command in the thread and closing the thread
        await messageQueue.add(async () => {
          thread?.postSystemMessage("Thread closed by user, closing...");
          suppressSystemMessages = true;
        });

        closedBy = "the user";
      } else {
        // A staff member is closing the thread
        if (!(await messageIsOnInboxServer(bot, msg))) return;
        if (!isStaff(msg.member)) return;

        thread = await threads.findOpenThreadByChannelId(db, msg.channel.id);
        if (!thread) return;

        const opts = (args.opts as Array<string>) || [];

        if (args.cancel || opts.includes("cancel") || opts.includes("c")) {
          // Cancel timed close
          if (thread.scheduled_close_at) {
            await thread.cancelScheduledClose();
            thread.postSystemMessage("Cancelled scheduled closing");
          }

          return;
        }

        // Silent close (= no close message)
        if (args.silent || opts.includes("silent") || opts.includes("s")) {
          silentClose = true;
        }

        // Timed close
        const delayStringRegex = /^(?:\d+[wdhms]?)+$/i;
        const delayStringArg = opts.find((arg) => delayStringRegex.test(arg));
        if (delayStringArg) {
          const delay = convertDelayStringToMS(delayStringArg);
          if (delay === 0 || delay === null) {
            thread.postSystemMessage(
              'Invalid delay specified. Format: "1h30m"',
            );
            return;
          }

          await thread.scheduleClose(delay, msg.author, silentClose);

          let response = "";
          if (silentClose) {
            response = `Thread is now scheduled to be closed silently in ${humanizeDelay(delay)}. Use \`${config.prefix}close cancel\` to cancel.`;
          } else {
            response = `Thread is now scheduled to be closed in ${humanizeDelay(delay)}. Use \`${config.prefix}close cancel\` to cancel.`;
          }

          thread.postSystemMessage(response);

          return;
        }

        // Regular close
        closedBy = config.useDisplaynames
          ? msg.author.globalName || msg.author.username
          : msg.author.username;
      }

      // Send close message (unless suppressed with a silent close)
      if (hasCloseMessage && !silentClose) {
        const closeMessage = readMultilineConfigValue(
          config.closeMessage || "Closed",
        );
        await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
      }

      await thread.close(suppressSystemMessages, silentClose);

      await sendCloseNotification(
        thread,
        `Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) was closed by ${closedBy} (${msg.author.id})`,
      );
    },
    {
      options: [
        { name: "silent", shortcut: "s", isSwitch: true },
        { name: "cancel", shortcut: "c", isSwitch: true },
      ],
    },
  );

  // Auto-close threads if their channel is deleted
  bot.on(Events.ChannelDelete, async (channel) => {
    if (!(channel instanceof GuildChannel)) return;
    if (channel.guild.id !== getInboxGuild().id) return;

    const thread = await threads.findOpenThreadByChannelId(db, channel.id);
    if (!thread) return;

    console.log(
      `[INFO] Auto-closing thread with ${thread.user_name} because the channel was deleted`,
    );
    if (config.closeMessage) {
      const closeMessage = readMultilineConfigValue(config.closeMessage);
      await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
    }

    await thread.close(true);

    await sendCloseNotification(
      thread,
      `Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) was closed automatically because the channel was deleted`,
    );
  });
};
