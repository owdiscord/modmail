import { accessSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import cfg from "../cfg";
import { formatters } from "../formatters";
import { getSelfUrl } from "../utils";
import { ThreadStatus } from "./constants";
import type Thread from "./Thread";
import type ThreadMessage from "./ThreadMessage";
import { AttachmentBuilder } from "discord.js";

const { logStorage, logOptions } = cfg;

interface LogStorageType {
  shouldSave?: (thread: Thread) => Promise<boolean> | boolean;
  save: (thread: Thread, threadMessages: Array<ThreadMessage>) => Promise<any>;
  getFile?: (
    thread: Thread,
  ) => Promise<{ file: string; name: string } | null | undefined>;
  getUrl?: (thread: Thread) => Promise<string>;
}

export const logStorageTypes: Record<string, LogStorageType> = {
  none: {
    async save(_thread, _messages) {
      return null;
    },
  },
  local: {
    async save(_thread, _messages) {
      return null;
    },
    getUrl(thread) {
      return getSelfUrl(`logs/${thread.id}`);
    },
  },
  attachment: {
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
      let fullPath = undefined;
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

export const addStorageType = (name: string, handler: LogStorageType) => {
  logStorageTypes[name] = handler;
};

export const saveLogToStorage = async (
  thread: Thread,
  storageType?: keyof typeof logStorageTypes,
) => {
  const storageSystem: LogStorageType = logStorageTypes[
    storageType || logStorage || "none"
  ] || {
    async save(_) {
      return null;
    },
  };

  if (storageSystem.shouldSave && !(await storageSystem.shouldSave(thread)))
    return;
  if (storageSystem.save) {
    const threadMessages = await thread.getThreadMessages();
    const storageData = await storageSystem.save(thread, threadMessages);
    await thread.updateLogStorageValues(storageType as string, storageData);
  }
};

export const getLogUrl = async (thread: Thread) => {
  if (!thread.log_storage_type) {
    await saveLogToStorage(thread);
  }

  const { getUrl } = logStorageTypes[thread.log_storage_type] || {};
  return getUrl ? getUrl(thread) : null;
};

export const getLogFile = async (
  thread: Thread,
): Promise<AttachmentBuilder | null | undefined> => {
  if (!thread.log_storage_type) {
    await saveLogToStorage(thread);
  }

  const { getFile } = logStorageTypes[thread.log_storage_type as string] || {};
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
