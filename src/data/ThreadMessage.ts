import type { SQL } from "bun";
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
	metadata?: string | Record<string | number | symbol, unknown>;
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
	public metadata: Record<string, string | ThreadMessage> = {};

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

		if (props.attachments) {
			if (typeof props.attachments === "string") {
				this.attachments = JSON.parse(props.attachments);
			}
		} else {
			this.attachments = [];
		}

		if (props.small_attachments) {
			if (typeof props.small_attachments === "string") {
				this.small_attachments = JSON.parse(props.small_attachments);
			}
		} else {
			this.small_attachments = [];
		}

		if (props.metadata) {
			if (typeof props.metadata === "string") {
				this.metadata = JSON.parse(props.metadata);
			}
		}
	}

	// getSQLProps(): { message_type: number; message_number: number } & Record<
	//   string,
	//   any
	// > {
	//   const out: { message_type: number; message_number: number } & Record<
	//     string,
	//     any
	//   > = {
	//     message_type: this.message_type,
	//     message_number: this.message_number,
	//   };
	//
	//   return Object.entries(this).reduce((obj, [key, value]) => {
	//     if (typeof value === "function") return obj;
	//     if (typeof value === "object" && value != null) {
	//       obj[key] = JSON.stringify(value);
	//     } else {
	//       obj[key] = value;
	//     }
	//     return obj;
	//   }, out);
	// }

	// async setMetadataValue(key: string, value: string | ThreadMessage) {
	//   this.metadata = this.metadata || {};
	//   this.metadata[key] = value;
	//
	//   if (this.id) {
	//     await knex("thread_messages")
	//       .where("id", this.id)
	//       .update({
	//         metadata: JSON.stringify(this.metadata),
	//       });
	//   }
	// }

	getMetadataValue(key: string): string | ThreadMessage | null | undefined {
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
			metadata: this.metadata,
			body: this.body,
		};

		try {
			return await db`
  INSERT INTO thread_messages ${db(messageData)}`;
		} catch (e) {
			throw new Error(
				`[ThreadMessage::saveToDb@ThreadMessage.ts:138] failed to save thread_message to db: ${e}`,
			);
		}
	}
}

export default ThreadMessage;
