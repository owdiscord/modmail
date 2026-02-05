import type { SQL } from "bun";
import type { Client, MessageCreateOptions } from "discord.js";
import config from "../config";
import { disableCodeBlocks, disableInlineCode, getTimestamp } from "../utils";
import { ThreadMessageType } from "./constants";

export type ThreadMessageProps = {
  thread_id: string;
  message_type?: ThreadMessageType;
  message_number?: number;
  user_id?: string;
  user_name?: string;
  body?: string;
  is_anonymous?: boolean;
  role_name?: string | null;
  attachments?: Array<string>;
  dm_message_id?: string;
  dm_channel_id?: string;
  small_attachments?: Array<string>;
  metadata?: string | Record<string, unknown>;
  inbox_message_id?: string;
  created_at?: Date;
};

export class ThreadMessage {
  public id: number = 0;
  public thread_id: string = "";
  public message_type: ThreadMessageType;
  public message_number: number = 0;
  public user_id: string = "";
  public user_name: string = "";
  public role_name: string = "";
  public body: string = "";
  public is_anonymous: boolean = false;
  public attachments: string[] = [];
  public small_attachments: string[] = [];
  public dm_channel_id: string = "";
  public dm_message_id: string = "";
  public inbox_message_id: string = "";
  public created_at: Date;
  public use_legacy_format = false;
  public metadata: Record<string, unknown> = {};

  constructor(props: ThreadMessageProps) {
    this.thread_id = props.thread_id;
    this.message_type = props.message_type || ThreadMessageType.System;
    this.message_number = props.message_number || 0;
    this.user_id = props.user_id || "";
    this.user_name = props.user_name || "";
    this.role_name = props.role_name || "";
    this.body = props.body || "";
    this.is_anonymous = props.is_anonymous || false;
    this.dm_channel_id = props.dm_channel_id || "";
    this.dm_message_id = props.dm_message_id || "";
    this.inbox_message_id = props.inbox_message_id || "";
    this.created_at = props.created_at || new Date();

    if (props.attachments)
      this.attachments =
        typeof props.attachments === "string"
          ? JSON.parse(props.attachments)
          : props.attachments;

    if (props.small_attachments)
      this.small_attachments =
        typeof props.small_attachments === "string"
          ? JSON.parse(props.small_attachments)
          : props.small_attachments;

    if (props.metadata)
      this.metadata =
        typeof props.metadata === "string"
          ? JSON.parse(props.metadata)
          : props.metadata;
  }

  getMetadataValue(key: string): unknown {
    return this.metadata ? this.metadata[key] : null;
  }

  isFromUser(): boolean {
    return this.message_type === ThreadMessageType.FromUser;
  }

  isChat(): boolean {
    return this.message_type === ThreadMessageType.Chat;
  }

  clone() {
    return new ThreadMessage(this);
  }

  async deleteFromDb(db: SQL) {
    return await db`DELETE FROM thread_messages WHERE id = ${this.id}`;
  }

  async updateInDb(db: SQL, data: Partial<ThreadMessage>) {
    return await db`UPDATE thread_messages SET ${db(data)} WHERE id = ${this.id}`;
  }

  async saveToDb(db: SQL) {
    const messageData = {
      thread_id: this.thread_id,
      user_id: this.user_id,
      user_name: this.user_name,
      is_anonymous: this.is_anonymous,
      created_at: new Date(),
      message_type: this.message_type,
      message_number: this.message_number,
      inbox_message_id: this.inbox_message_id ? this.inbox_message_id : null,
      dm_message_id: this.dm_message_id ? this.dm_message_id : null,
      dm_channel_id: this.dm_channel_id,
      role_name: this.role_name,
      attachments: this.attachments,
      small_attachments: this.small_attachments,
      use_legacy_format: this.use_legacy_format,
      metadata: JSON.stringify(this.metadata),
      body: this.body,
    };

    try {
      return await db`INSERT INTO thread_messages ${db(messageData)} ON DUPLICATE KEY UPDATE body = ${messageData.body}`;
    } catch (e) {
      throw new Error(
        `[ThreadMessage::saveToDb@ThreadMessage.ts:138] failed to save thread_message to db: ${e}`,
      );
    }
  }

  public formatAsStaffReplyDM(): MessageCreateOptions {
    let content = this.body;

    if (this.attachments.length > 0)
      content += `\n\n${this.attachments.join("\n")}`;

    const roleName =
      config.overrideRoleNameDisplay ||
      this.role_name ||
      config.fallbackRoleName;
    const modInfo = this.is_anonymous
      ? roleName
      : roleName
        ? `(${roleName}) ${this.user_name}`
        : this.user_name;

    return {
      content: modInfo ? `**${modInfo}:** ${content}` : content,
    };
  }

  public formatAsStaffReplyThreadMessage(): MessageCreateOptions {
    const roleName =
      config.overrideRoleNameDisplay ||
      this.role_name ||
      config.fallbackRoleName;
    const modInfo = this.is_anonymous
      ? roleName
        ? `(Anonymous) (${this.user_name}) ${roleName}`
        : `(Anonymous) (${this.user_name})`
      : roleName
        ? `(${roleName}) ${this.user_name}`
        : this.user_name;

    let result = modInfo ? `**${modInfo}:** ${this.body}` : this.body;

    if (config.threadTimestamps) {
      const formattedTimestamp = getTimestamp(this.created_at);
      result = `[${formattedTimestamp}] ${result}`;
    }

    result = `\`${this.message_number}\`  ${result}`;

    return {
      content: result,
    };
  }

  public formatAsUserReply(): MessageCreateOptions {
    let result = `**${this.user_name}:** ${this.body}`;

    if (this.attachments.length > 0)
      result += `\n\n${this.attachments.join("\n")}`;

    if (config.threadTimestamps) {
      const formattedTimestamp = getTimestamp(this.created_at);
      result = `[${formattedTimestamp}] ${result}`;
    }

    return {
      content: result,
    };
  }

  public formatAsSystem(): MessageCreateOptions {
    let result = this.body;

    if (this.attachments.length > 0)
      result += `\n\n${this.attachments.join("\n")}`;

    return {
      content: result,
    };
  }

  public formatAsSystemToUserThreadMessage(bot: Client): MessageCreateOptions {
    let result = `**⚙️ ${bot.user?.username}:** ${this.body}`;

    if (this.attachments.length > 0)
      result += `\n\n${this.attachments.join("\n")}`;

    return {
      content: result,
    };
  }

  public formatAsSystemToUserDM(): MessageCreateOptions {
    let result = this.body;

    if (this.attachments.length > 0)
      result += `\n\n${this.attachments.join("\n")}`;

    return {
      content: result,
    };
  }

  public formatAsStaffReplyEdit(): MessageCreateOptions | null {
    const originalThreadMessage = this.getMetadataValue(
      "originalThreadMessage",
    );
    if (
      !originalThreadMessage ||
      !(originalThreadMessage instanceof ThreadMessage)
    )
      return null;

    const newBody = this.getMetadataValue("newBody") as string;

    let content = `**${originalThreadMessage.user_name}** (\`${originalThreadMessage.user_id}\`) edited reply \`${originalThreadMessage.message_number}\``;

    if (originalThreadMessage.body.length < 200 && newBody.length < 200) {
      // Show edits of small messages inline
      content += ` from \`${disableInlineCode(originalThreadMessage.body)}\` to \`${newBody}\``;
    } else {
      // Show edits of long messages in two code blocks
      content += ":";
      content += `\n\n\`B\`:\n\`\`\`${disableCodeBlocks(originalThreadMessage.body)}\`\`\``;
      content += `\n\`A\`:\n\`\`\`${disableCodeBlocks(newBody)}\`\`\``;
    }

    return { content };
  }
  public formatAsStaffReplyDeletion(): MessageCreateOptions | null {
    const originalThreadMessage = this.getMetadataValue(
      "originalThreadMessage",
    );
    if (
      !originalThreadMessage ||
      !(originalThreadMessage instanceof ThreadMessage)
    )
      return null;

    let content = `**${originalThreadMessage.user_name}** (\`${originalThreadMessage.user_id}\`) deleted reply \`${originalThreadMessage.message_number}\``;

    if (originalThreadMessage.body.length < 200) {
      // Show the original content of deleted small messages inline
      content += ` (message content: \`${disableInlineCode(originalThreadMessage.body)}\`)`;
    } else {
      // Show the original content of deleted large messages in a code block
      content += `:\n\`\`\`${disableCodeBlocks(originalThreadMessage.body)}\`\`\``;
    }

    return { content };
  }
}

export default ThreadMessage;
