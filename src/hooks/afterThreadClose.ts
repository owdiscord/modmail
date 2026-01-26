interface AfterThreadCloseHookData {
	threadId: string;
}

export type AfterThreadCloseHookFn = (
	data: AfterThreadCloseHookData,
) => Promise<void>;
const afterThreadCloseHooks: Array<AfterThreadCloseHookFn> = [];

export function afterThreadClose(fn: AfterThreadCloseHookFn) {
	afterThreadCloseHooks.push(fn);
}

export async function callAfterThreadCloseHooks(
	input: AfterThreadCloseHookData,
) {
	for (const hook of afterThreadCloseHooks) {
		await hook(input);
	}
}
