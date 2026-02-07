import { accessSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AttachmentBuilder } from "discord.js";
import config from "../config";
import { getSelfUrl } from "../utils";
import { ThreadMessageType, ThreadStatus } from "./constants";
import type Thread from "./Thread";
import ThreadMessage from "./ThreadMessage";
import { getRegisteredUsername } from "./Registration";
import { useDb } from "../db";

interface LogStorageType {
  shouldSave?: (thread: Thread) => Promise<boolean> | boolean;
  save: (
    thread: Thread,
    threadMessages: Array<ThreadMessage>,
  ) => Promise<{ fullPath: string; filename: string } | string>;
  getFile?: (
    thread: Thread,
  ) => Promise<{ file: string; name: string } | null | undefined>;
  getUrl: (thread: Thread) => Promise<string>;
}

export type LogStorageTypes = "none" | "local" | "attachment";

export const logStorageTypes: Record<
  "none" | "local" | "attachment",
  LogStorageType
> = {
  none: {
    async save(_thread, _messages) {
      return "";
    },
    getUrl: async (_) => "",
  },
  local: {
    async save(_thread, _messages) {
      return "";
    },
    getUrl(thread) {
      return getSelfUrl(`logs/${thread.id}`);
    },
  },
  attachment: {
    getUrl: async (_) => "",
    shouldSave(thread: Thread) {
      return thread.status === ThreadStatus.Closed;
    },
    async save(thread: Thread, threadMessages: Array<ThreadMessage>) {
      const { fullPath, filename } = getLogAttachmentFilename(thread.id);
      const formatLogResult = await formatLog(thread, threadMessages);
      writeFileSync(fullPath, formatLogResult.content, { encoding: "utf8" });
      return { fullPath, filename };
    },
    async getFile(thread: Thread) {
      let fullPath: string | undefined;
      let filename = "unknown";

      if (typeof thread.log_storage_data !== "string") {
        fullPath = thread.log_storage_data.fullPath || undefined;
        filename = thread.log_storage_data.filename;
      }

      if (!fullPath) return;
      try {
        accessSync(fullPath);
      } catch (_e) {
        return null;
      }
      return {
        file: readFileSync(fullPath, { encoding: "utf8" }),
        name: filename,
      };
    },
  },
};

export const saveLogToStorage = async (
  thread: Thread,
  storageType: keyof typeof logStorageTypes = "none",
) => {
  if (!Object.keys(logStorageTypes).includes(storageType)) return;
  const storageSystem: LogStorageType = logStorageTypes[storageType];

  if (storageSystem.shouldSave && !(await storageSystem.shouldSave(thread)))
    return;
  if (storageSystem.save) {
    const threadMessages = await thread.getThreadMessages();
    const storageData = await storageSystem.save(thread, threadMessages);

    await thread.updateLogStorageValues(storageType, storageData);
  }
};

export const getLogUrl = async (thread: Thread): Promise<string> => {
  if (!thread.log_storage_type) {
    await saveLogToStorage(thread);
  }

  if (thread.log_storage_type === "local")
    return logStorageTypes?.local?.getUrl(thread);

  const { getUrl } =
    logStorageTypes[thread.log_storage_type] || logStorageTypes.local;
  return getUrl ? getUrl(thread) : "";
};

export const getLogFile = async (
  thread: Thread,
): Promise<AttachmentBuilder | null | undefined> => {
  if (!thread.log_storage_type) {
    await saveLogToStorage(thread);
  }

  const { getFile } = logStorageTypes[thread.log_storage_type] || {};
  if (getFile) {
    const data = await getFile(thread);
    if (data) {
      const { file, name } = data;
      const attachment = new AttachmentBuilder(Buffer.from(file, "utf-8"), {
        name,
      });

      return attachment;
    }
  }

  return null;
};

export const getLogCustomResponse = async (_thread: Thread) => {
  return null;
  // if (!thread.log_storage_type) {
  //   await saveLogToStorage(thread);
  // }
  //
  // return (
  //   logStorageTypes[thread.log_storage_type]?.getCustomResponse(thread) || null
  // );
};

export const getLogAttachmentFilename = (threadId: string) => {
  const filename = `${threadId}.txt`;
  const fullPath = join(config.logOptions?.attachmentDirectory || "", filename);

  return { filename, fullPath };
};

export const formatLog = async (
  thread: Thread,
  threadMessages: Array<ThreadMessage>,
  opts = { simple: false, verbose: false },
) => {
  const db = useDb();

  if (opts.simple) {
    threadMessages = threadMessages.filter((message) => {
      return (
        message.message_type !== ThreadMessageType.System &&
        message.message_type !== ThreadMessageType.SystemToUser &&
        message.message_type !== ThreadMessageType.Chat &&
        message.message_type !== ThreadMessageType.Command
      );
    });
  }

  const lines = await Promise.all(
    threadMessages.map(async (message) => {
      // Legacy messages (from 2018) are the entire log in one message, so just serve them as they are
      if (message.message_type === ThreadMessageType.Legacy) {
        return message.body;
      }

      const time = message.created_at
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);

      let line = `[${time}]`;

      if (opts.verbose) {
        if (message.dm_channel_id) {
          line += ` [DM CHA ${message.dm_channel_id}]`;
        }

        if (message.dm_message_id) {
          line += ` [DM MSG ${message.dm_message_id}]`;
        }
      }

      const originalThreadMessage = message.getMetadataValue(
        "originalThreadMessage",
      );

      const registeredName = await getRegisteredUsername(db, message.user_id);

      if (message.message_type === ThreadMessageType.FromUser) {
        line += ` [FROM USER] [${message.user_name}] ${message.body}`;
      } else if (message.message_type === ThreadMessageType.ToUser) {
        if (opts.verbose) {
          line += ` [TO USER] [${message.message_number || "0"}] [${registeredName ? registeredName : message.user_name}]`;
        } else {
          line += ` [TO USER] [${registeredName ? registeredName : message.user_name}]`;
        }

        if (message.use_legacy_format) {
          // Legacy format (from pre-2.31.0) includes the role and username in the message body, so serve that as is
          line += ` ${message.body}`;
        } else if (message.is_anonymous) {
          if (message.role_name) {
            line += ` (Anonymous) ${message.role_name}: ${message.body}`;
          } else {
            line += ` (Anonymous) Moderator: ${message.body}`;
          }
        } else {
          if (message.role_name) {
            line += ` (${message.role_name}) ${registeredName ? registeredName : message.user_name}: ${message.body}`;
          } else {
            line += ` ${registeredName ? registeredName : message.user_name}: ${message.body}`;
          }
        }
      } else if (message.message_type === ThreadMessageType.System) {
        line += ` [BOT] ${message.body}`;
      } else if (message.message_type === ThreadMessageType.SystemToUser) {
        line += ` [BOT TO USER] ${message.body}`;
      } else if (message.message_type === ThreadMessageType.Chat) {
        line += ` [CHAT] [${registeredName ? registeredName : message.user_name}] ${message.body}`;
        if (message.metadata.attachments?.constructor === Array)
          line += `${message.body.length > 0 && message.metadata.attachments ? "\n" : ""}${(message.metadata.attachments as Array<string>).join("\n")}`;
      } else if (message.message_type === ThreadMessageType.Command) {
        line += ` [COMMAND] [${registeredName ? registeredName : message.user_name}] ${message.body}`;
      } else if (message.message_type === ThreadMessageType.ReplyEdited) {
        if (
          !originalThreadMessage ||
          !(originalThreadMessage instanceof ThreadMessage)
        )
          return message.body;
        line += ` [REPLY EDITED] ${originalThreadMessage.user_name} edited reply ${originalThreadMessage.message_number}:`;
        line += `\n\nBefore:\n${originalThreadMessage.body}`;
        line += `\n\nAfter:\n${message.getMetadataValue("newBody")}`;
      } else if (message.message_type === ThreadMessageType.ReplyDeleted) {
        if (
          !originalThreadMessage ||
          !(originalThreadMessage instanceof ThreadMessage)
        )
          return message.body;
        line += ` [REPLY DELETED] ${originalThreadMessage.user_name} deleted reply ${originalThreadMessage.message_number}:`;
        line += `\n\n${originalThreadMessage.body}`;
      } else {
        line += ` [${message.user_name}] ${message.body}`;
      }

      if (message.attachments.length > 0)
        line += `\n\n${message.attachments.join("\n")}`;

      return line;
    }),
  );

  const header = `# Modmail thread #${thread.thread_number} with ${thread.user_name} (${thread.user_id}) started at <t:${Math.round(thread.created_at.getTime() / 1000)}:S>. All times are in UTC+0.`;

  const fullResult = `${header}\n\n${lines.join("\n")}`;

  return {
    content: fullResult,
  };
};
