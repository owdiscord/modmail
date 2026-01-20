import type { Message, User } from "discord.js";
import type { CreateNewThreadForUserOpts } from "../data/threads";

interface BeforeNewThreadHookData {
	user: User;
	message?: Message;
	opts: CreateNewThreadForUserOpts;
	cancel: () => void;
	setCategoryId: (value: string) => void;
}

export interface BeforeNewThreadHookResult {
	cancelled: boolean;
	categoryId: string | null;
}

const beforeNewThreadHooks: Array<
	(data: BeforeNewThreadHookData) => Promise<void>
> = [];
export function beforeNewThread(
	fn: (data: BeforeNewThreadHookData) => Promise<void>,
) {
	beforeNewThreadHooks.push(fn);
}

export async function callBeforeNewThreadHooks(input: {
	user: User;
	message?: Message;
	opts: CreateNewThreadForUserOpts;
}) {
	const result: BeforeNewThreadHookResult = {
		cancelled: false,
		categoryId: null,
	};

	const data = {
		...input,

		cancel() {
			result.cancelled = true;
		},

		setCategoryId(value: string) {
			result.categoryId = value;
		},
	};

	for (const hook of beforeNewThreadHooks) {
		await hook(data);
	}

	return result;
}
