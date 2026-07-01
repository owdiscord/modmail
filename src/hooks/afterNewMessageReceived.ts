import type { Message, User } from "discord.js";
import type { NewThreadParams } from "../data/Thread";

interface AfterNewMessageReceivedHookData {
  user: User;
  message?: Message;
  opts: NewThreadParams;
}

export type AfterNewMessageReceivedHookFn = (
  data: AfterNewMessageReceivedHookData,
) => Promise<void>;
const afterNewMessageReceivedHooks: Array<AfterNewMessageReceivedHookFn> = [];

export function afterNewMessageReceived(fn: AfterNewMessageReceivedHookFn) {
  afterNewMessageReceivedHooks.push(fn);
}

export async function callAfterNewMessageReceivedHooks(
  input: AfterNewMessageReceivedHookData,
) {
  for (const hook of afterNewMessageReceivedHooks) {
    await hook(input);
  }
}
