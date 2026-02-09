import { getThreadsThatShouldBeClosed } from "../data/threads";
import type { ModuleProps } from "../plugins";
import {
  getLogChannel,
  humanizeDelay,
  readMultilineConfigValue,
} from "../utils";
import { getDelayFromArgs } from "../utils/time";

export default ({ config, commands, db }: ModuleProps) => {
  // Check for threads that are scheduled to be closed and close them
  async function applyScheduledCloses() {
    const threadsToBeClosed = await getThreadsThatShouldBeClosed(db);
    for (const thread of threadsToBeClosed) {
      if (config.closeMessage && !thread.scheduled_close_silent) {
        const closeMessage = readMultilineConfigValue(config.closeMessage);
        await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
      }

      await thread.close(
        thread.scheduled_close_id || "unknown",
        false,
        thread.scheduled_close_silent || undefined,
      );

      const logChannel = await getLogChannel();
      const embed = await thread.getCloseEmbed(thread.scheduled_close_id || "");
      if (!embed)
        return logChannel.send(
          `Thread ${thread.id} closed by ${thread.scheduled_close_name}. ${await thread.logUrl()}`,
        );

      logChannel.send({
        embeds: [embed],
      });
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
  commands.addInboxThreadCommand(
    "close",
    "[opts...]",
    async (msg, args, thread) => {
      let closedBy = "Nobody";

      const hasCloseMessage = !!config.closeMessage;
      let silentClose = false;
      let suppressSystemMessages = false;

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

      let delayArgs = opts.filter((s) => s !== "silent" && s !== "s");
      if (delayArgs.length > 0) {
        try {
          const delay = await getDelayFromArgs(opts);

          if (delay !== null) {
            await thread.scheduleClose(delay, msg.author, silentClose);

            if (silentClose)
              thread.postSystemMessage({
                content: `Thread is now scheduled to be closed silently in ${humanizeDelay(delay)}. Use \`${config.prefix}close cancel\` to cancel.`,
              });
            else
              thread.postSystemMessage({
                content: `Thread is now scheduled to be closed in ${humanizeDelay(delay)}. Use \`${config.prefix}close cancel\` to cancel.`,
              });

            return;
          }
        } catch (e: unknown) {
          thread.postSystemMessage({
            content: `${e}`,
          });

          return;
        }

        thread.postSystemMessage({
          content:
            "Invalid delay duration given. Expected format example for 10 days, 11 hours, 2 minutes, and 56 seconds: 10d11h2m56s",
        });
        return;
      }

      // Regular close
      closedBy = config.useDisplaynames
        ? msg.author.globalName || msg.author.username
        : msg.author.username;

      // Send close message (unless suppressed with a silent close)
      if (hasCloseMessage && !silentClose) {
        const closeMessage = readMultilineConfigValue(
          config.closeMessage || "Closed",
        );
        await thread.sendSystemMessageToUser(closeMessage).catch(() => {});
      }

      await thread.close(msg.author.id, suppressSystemMessages, silentClose);

      const embed = await thread.getCloseEmbed(msg.author.id);
      const logChannel = await getLogChannel();
      if (!embed) {
        logChannel.send(
          `Thread #${thread.id} closed by ${msg.author.id}. ${await thread.logUrl()}`,
        );
        return;
      }

      logChannel.send({
        embeds: [embed],
      });
    },
    {
      options: [
        { name: "silent", shortcut: "s", isSwitch: true },
        { name: "cancel", shortcut: "c", isSwitch: true },
      ],
    },
  );
};
