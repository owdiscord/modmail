import type { SQL } from "bun";
import type { Client } from "discord.js";
import type { Commands } from "./commands";
import type { ModmailConfig } from "./config";
import { downloadAttachment, saveAttachment } from "./data/attachments";
import displayRoles from "./data/displayRoles";
import {
  getLogCustomResponse,
  getLogFile,
  getLogUrl,
  saveLogToStorage,
} from "./data/logs";
import { afterNewMessageReceived } from "./hooks/afterNewMessageReceived";
import { afterThreadClose } from "./hooks/afterThreadClose";
import { afterThreadCloseScheduleCanceled } from "./hooks/afterThreadCloseScheduleCanceled";
import { afterThreadCloseScheduled } from "./hooks/afterThreadCloseScheduled";
import { beforeNewMessageReceived } from "./hooks/beforeNewMessageReceived";
import { beforeNewThread } from "./hooks/beforeNewThread";
import alert from "./plugins/alert";
import block from "./plugins/block";
import close from "./plugins/close";
import greeting from "./plugins/greeting";
import id from "./plugins/id";
import info from "./plugins/info";
import joinLeaveNotification from "./plugins/joinLeaveNotification";
import logs from "./plugins/logs";
import move from "./plugins/move";
import newThread from "./plugins/newthread";
import notes from "./plugins/notes";
import reply from "./plugins/reply";
import resetId from "./plugins/resetId";
import roles from "./plugins/roles";
import snippets from "./plugins/snippets";
import suspend from "./plugins/suspend";
import typingProxy from "./plugins/typingProxy";
import staffRegistration from "./plugins/staffRegistration";

export type ModuleProps = {
  bot: Client;
  config: ModmailConfig;
  commands: Commands;
  db: SQL;
  attachments: {
    downloadAttachment: typeof downloadAttachment;
    saveAttachment: typeof saveAttachment;
  };
  logs: {
    saveLogToStorage: typeof saveLogToStorage;
    getLogUrl: typeof getLogUrl;
    getLogFile: typeof getLogFile;
    getLogCustomResponse: typeof getLogCustomResponse;
  };
  hooks: {
    beforeNewThread: typeof beforeNewThread;
    beforeNewMessageReceived: typeof beforeNewMessageReceived;
    afterNewMessageReceived: typeof afterNewMessageReceived;
    afterThreadClose: typeof afterThreadClose;
    afterThreadCloseScheduled: typeof afterThreadCloseScheduled;
    afterThreadCloseScheduleCanceled: typeof afterThreadCloseScheduleCanceled;
  };
  displayRoles: typeof displayRoles;
};

export function loadPlugins(props: ModuleProps) {
  const plugins = [
    id,
    alert,
    block,
    close,
    greeting,
    info,
    joinLeaveNotification,
    logs,
    move,
    newThread,
    notes,
    reply,
    resetId,
    roles,
    snippets,
    suspend,
    typingProxy,
    staffRegistration,
  ];

  for (const plugin of plugins) {
    plugin(props);
  }

  return plugins.length;
}

export function createPluginProps({
  bot,
  db,
  config,
  commands,
}: {
  bot: Client;
  db: SQL;
  config: ModmailConfig;
  commands: Commands;
}): ModuleProps {
  return {
    bot,
    db,
    config,
    commands,
    attachments: {
      downloadAttachment: downloadAttachment,
      saveAttachment: saveAttachment,
    },
    logs: {
      saveLogToStorage: saveLogToStorage,
      getLogUrl: getLogUrl,
      getLogFile: getLogFile,
      getLogCustomResponse: getLogCustomResponse,
    },
    hooks: {
      beforeNewThread,
      beforeNewMessageReceived,
      afterNewMessageReceived,
      afterThreadClose,
      afterThreadCloseScheduled,
      afterThreadCloseScheduleCanceled,
    },
    displayRoles,
  };
}
