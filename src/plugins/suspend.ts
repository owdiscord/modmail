import { ThreadStatus } from "../data/constants";
import {
  findOpenThreadByUserID,
  findSuspendedThreadByChannelId,
  getThreadsThatShouldBeSuspended,
} from "../repositories/threads";
import type { ModuleProps } from "../plugins";
import { humanizeDelay } from "../utils";
import {
  cancelScheduledSuspend,
  postSystemMessage,
  scheduleSuspend,
  suspend,
  unsuspend,
} from "../thread";

export default ({ db, config, commands }: ModuleProps) => {
  if (!config.allowSuspend) return;
  // Check for threads that are scheduled to be suspended and suspend them
  async function applyScheduledSuspensions() {
    const threadsToBeSuspended = await getThreadsThatShouldBeSuspended(db);
    for (const thread of threadsToBeSuspended) {
      if (thread.status === ThreadStatus.Open) {
        await thread.suspend();
        await thread.postSystemMessage(
          `**Thread suspended** as scheduled by ${thread.scheduled_suspend_name}. This thread will act as closed until unsuspended with \`${config.prefix}unsuspend\``,
        );
      }
    }
  }

  async function scheduledSuspendLoop() {
    try {
      await applyScheduledSuspensions();
    } catch (e) {
      console.error(e);
    }

    setTimeout(scheduledSuspendLoop, 2000);
  }

  scheduledSuspendLoop();

  commands.addInboxThreadCommand(
    "suspend cancel",
    [],
    async (_msg, _args, thread) => {
      if (!thread) return;
      // Cancel timed suspend
      if (thread.scheduled_suspend_at) {
        await cancelScheduledSuspend(db, thread);
        postSystemMessage(db, thread, "Cancelled scheduled suspension");
      } else {
        postSystemMessage(
          db,
          thread,
          "Thread is not scheduled to be suspended",
        );
      }
    },
  );

  commands.addInboxThreadCommand(
    "suspend",
    "[delay:delay]",
    async (msg, args, thread) => {
      if (!thread) return;
      if (thread.status === ThreadStatus.Suspended) {
        postSystemMessage(db, thread, "Thread is already suspended.");
        return;
      }
      if (args.delay && typeof args.delay === "number") {
        await scheduleSuspend(db, thread, args.delay, msg.author);

        postSystemMessage(
          db,
          thread,
          `Thread will be suspended in ${humanizeDelay(args.delay)}. Use \`${config.prefix}suspend cancel\` to cancel.`,
        );

        return;
      }

      await suspend(db, thread);
      postSystemMessage(
        db,
        thread,
        `**Thread suspended!** This thread will act as closed until unsuspended with \`${config.prefix}unsuspend\``,
      );
    },
    { allowSuspended: true },
  );

  commands.addInboxServerCommand(
    "unsuspend",
    [],
    async (msg, _args, thread) => {
      if (thread) {
        postSystemMessage(db, thread, "Thread is not suspended");
        return;
      }

      thread =
        (await findSuspendedThreadByChannelId(db, msg.channel.id)) || undefined;
      if (!thread) {
        msg.channel.isSendable() && msg.channel.send("Not in a thread");
        return;
      }

      const otherOpenThread = (
        await findOpenThreadByUserID(db, thread.user_id)
      )[0];
      if (otherOpenThread) {
        postSystemMessage(
          db,
          thread,
          `Cannot unsuspend; there is another open thread with this user: <#${otherOpenThread.channel_id}>`,
        );
        return;
      }

      await unsuspend(db, thread);
      postSystemMessage(db, thread, "**Thread unsuspended!**");
    },
  );
};
