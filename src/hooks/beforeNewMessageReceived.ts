import type { Message, User } from "discord.js";
import type { CreateNewThreadForUserOpts } from "../data/threads";

interface BeforeNewMessageReceivedHookData {
	user: User;
	message?: Message;
	opts: CreateNewThreadForUserOpts;
	cancel: () => void;
}

export interface BeforeNewMessageReceivedHookResult {
	cancelled: boolean;
}

export type BeforeNewMessageReceivedHookFn = (
	data: BeforeNewMessageReceivedHookData,
) => Promise<void>;
const beforeNewMessageReceivedHooks: Array<BeforeNewMessageReceivedHookFn> = [];

export function beforeNewMessageReceived(fn: BeforeNewMessageReceivedHookFn) {
	beforeNewMessageReceivedHooks.push(fn);
}

export async function callBeforeNewMessageReceivedHooks(
	input: BeforeNewMessageReceivedHookData,
) {
	const result: BeforeNewMessageReceivedHookResult = {
		cancelled: false,
	};

	const data = {
		...input,

		cancel() {
			result.cancelled = true;
		},
	};

	for (const hook of beforeNewMessageReceivedHooks) {
		await hook(data);
	}

	return result;
}
