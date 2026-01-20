import type Thread from "../data/Thread";

interface AfterThreadCloseScheduledHookData {
	thread: Thread;
}

export type AfterThreadCloseScheduledHookFn = (
	data: AfterThreadCloseScheduledHookData,
) => Promise<void>;
const afterThreadCloseScheduledHooks: Array<AfterThreadCloseScheduledHookFn> =
	[];

export function afterThreadCloseScheduled(fn: AfterThreadCloseScheduledHookFn) {
	afterThreadCloseScheduledHooks.push(fn);
}

export async function callAfterThreadCloseScheduledHooks(
	input: AfterThreadCloseScheduledHookData,
) {
	for (const hook of afterThreadCloseScheduledHooks) {
		await hook(input);
	}
}
