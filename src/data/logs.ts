import { accessSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AttachmentBuilder } from "discord.js";
import cfg from "../cfg";
import { formatters } from "../formatters";
import { getSelfUrl } from "../utils";
import { ThreadStatus } from "./constants";
import type Thread from "./Thread";
import type ThreadMessage from "./ThreadMessage";

const { logOptions } = cfg;

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
      const formatLogResult = formatters.formatLog(thread, threadMessages);
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
  const fullPath = join(logOptions?.attachmentDirectory || "", filename);

  return { filename, fullPath };
};
