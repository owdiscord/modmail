import { ThreadMessageType } from "./constants";

export interface ThreadMessage {
  id?: number;
  thread_id: string;
  message_type: ThreadMessageType;
  message_number: number;
  user_id: string;
  user_name: string;
  role_name: string;
  body: string;
  is_anonymous: boolean;
  attachments: string[];
  small_attachments: string[];
  dm_channel_id: string;
  dm_message_id: string;
  inbox_message_id: string;
  created_at: Date;
  metadata: Record<string, unknown>;
  use_legacy_format: boolean;
}
