import { getPrettyVersion } from "../botVersion";
import { getAvailableUpdate } from "../data/updates";
import type { ModuleProps } from "../plugins";
import { postSystemMessageWithFallback } from "../utils";

export default ({ config, commands }: ModuleProps) => {
	commands.addInboxServerCommand("version", [], async (msg, _args, thread) => {
		let response = `OW2 Modmail ${getPrettyVersion()}`;

		if (config.updateNotifications) {
			const availableUpdate = await getAvailableUpdate();
			if (availableUpdate) {
				response += ` (version ${availableUpdate} available)`;
			}
		}

		if (!msg.channel.isSendable() || !thread) return;

		postSystemMessageWithFallback(msg.channel, thread, response);
	});
};
