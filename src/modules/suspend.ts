import { ThreadStatus } from "../data/constants";
import {
  findOpenThreadByUserId,
  findSuspendedThreadByChannelId,
  getThreadsThatShouldBeSuspended,
} from "../data/threads";
import type { ModuleProps } from "../plugins";
import { humanizeDelay } from "../utils";

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
        await thread.cancelScheduledSuspend();
        thread.postSystemMessage("Cancelled scheduled suspension");
      } else {
        thread.postSystemMessage("Thread is not scheduled to be suspended");
      }
    },
  );

  commands.addInboxThreadCommand(
    "suspend",
    "[delay:delay]",
    async (msg, args, thread) => {
      if (!thread) return;
      if (thread.status === ThreadStatus.Suspended) {
        thread.postSystemMessage("Thread is already suspended.");
        return;
      }
      if (args.delay) {
        const suspendAt = new Date(Date.now() + args.delay);
        await thread.scheduleSuspend(suspendAt, msg.author);

        thread.postSystemMessage(
          `Thread will be suspended in ${humanizeDelay(args.delay)}. Use \`${config.prefix}suspend cancel\` to cancel.`,
        );

        return;
      }

      await thread.suspend();
      thread.postSystemMessage(
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
        thread.postSystemMessage("Thread is not suspended");
        return;
      }

      thread =
        (await findSuspendedThreadByChannelId(db, msg.channel.id)) || undefined;
      if (!thread) {
        msg.channel.isSendable() && msg.channel.send("Not in a thread");
        return;
      }

      const otherOpenThread = await findOpenThreadByUserId(db, thread.user_id);
      if (otherOpenThread) {
        thread.postSystemMessage(
          `Cannot unsuspend; there is another open thread with this user: <#${otherOpenThread.channel_id}>`,
        );
        return;
      }

      await thread.unsuspend();
      thread.postSystemMessage("**Thread unsuspended!**");
    },
  );
};
