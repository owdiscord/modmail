import type { ModuleProps } from "../plugins";
import * as utils from "../utils";

export default ({ config, commands }: ModuleProps) => {
  commands.addInboxThreadCommand(
    "reply",
    "[text$]",
    async (msg, args, thread) => {
      if (!thread) return;

      if (!args.text && msg.attachments.size === 0) {
        utils.postError(msg.channel, "Text or attachment required");
        return;
      }

      const replied = await thread.replyToUser(
        msg.member,
        (args.text as string) || "",
        msg.attachments,
        false,
        msg.reference,
      );
      if (replied) msg.delete();
    },
    {
      aliases: ["r"],
    },
  );

  // Anonymous replies only show the role, not the username
  commands.addInboxThreadCommand(
    "anonreply",
    "[text$]",
    async (msg, args, thread) => {
      if (!thread) return;
      if (!args.text && msg.attachments.size === 0) {
        utils.postError(msg.channel, "Text or attachment required");
        return;
      }

      const replied = await thread.replyToUser(
        msg.member,
        (args.text as string) || "",
        msg.attachments,
        true,
        msg.reference,
      );
      if (replied) msg.delete();
    },
    {
      aliases: ["ar"],
    },
  );

  // Replies always with the role and the username. Useful if forceAnon is enabled.
  commands.addInboxThreadCommand(
    "realreply",
    "[text$]",
    async (msg, args, thread) => {
      if (!thread) return;

      if (!args.text && msg.attachments.size === 0) {
        utils.postError(msg.channel, "Text or attachment required");
        return;
      }

      const replied = await thread.replyToUser(
        msg.member,
        (args.text as string) || "",
        msg.attachments,
        false,
        msg.reference,
      );
      if (replied) msg.delete();
    },
    {
      aliases: ["rr"],
    },
  );

  if (config.allowStaffEdit) {
    commands.addInboxThreadCommand(
      "edit",
      "<messageNumber:number> <text:string$>",
      async (msg, args, thread) => {
        if (!thread) return;

        const threadMessage = await thread.findThreadMessageByMessageNumber(
          args.messageNumber as number,
        );

        if (!threadMessage) {
          utils.postError(msg.channel, "Unknown message number");
          return;
        }

        if (threadMessage.user_id !== msg.author.id) {
          utils.postError(msg.channel, "You can only edit your own replies");
          return;
        }

        const edited = await thread.editStaffReply(
          threadMessage,
          args.text as string,
          false,
        );
        if (edited) msg.delete().catch(utils.noop);
      },
      {
        aliases: ["e"],
      },
    );
  }

  if (config.allowStaffDelete) {
    commands.addInboxThreadCommand(
      "delete",
      "<messageNumber:number>",
      async (msg, args, thread) => {
        if (!thread) return;

        const threadMessage = await thread.findThreadMessageByMessageNumber(
          args.messageNumber as number,
        );
        if (!threadMessage) {
          utils.postError(msg.channel, "Unknown message number");
          return;
        }

        if (threadMessage.user_id !== msg.author.id) {
          utils.postError(msg.channel, "You can only delete your own replies");
          return;
        }

        await thread.deleteStaffReply(threadMessage, false);
        msg.delete().catch(utils.noop);
      },
      {
        aliases: ["d"],
      },
    );
  }
};
