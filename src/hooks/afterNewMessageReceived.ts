import type { Message, User } from "discord.js";
import type { CreateNewThreadForUserOpts } from "../data/threads";

interface AfterNewMessageReceivedHookData {
	user: User;
	message?: Message;
	opts: CreateNewThreadForUserOpts;
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
