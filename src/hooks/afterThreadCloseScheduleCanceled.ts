import type Thread from "../data/Thread";

interface AfterThreadCloseScheduleCanceledHookData {
	thread: Thread;
}

export type AfterThreadCloseScheduleCanceledHookFn = (
	data: AfterThreadCloseScheduleCanceledHookData,
) => Promise<void>;
const afterThreadCloseScheduleCanceledHooks: Array<AfterThreadCloseScheduleCanceledHookFn> =
	[];

export function afterThreadCloseScheduleCanceled(
	fn: AfterThreadCloseScheduleCanceledHookFn,
) {
	afterThreadCloseScheduleCanceledHooks.push(fn);
}

export async function callAfterThreadCloseScheduleCanceledHooks(
	input: AfterThreadCloseScheduleCanceledHookData,
) {
	for (const hook of afterThreadCloseScheduleCanceledHooks) {
		await hook(input);
	}
}
