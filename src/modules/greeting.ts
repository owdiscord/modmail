import { AttachmentBuilder, Events } from "discord.js";
import type { ModuleProps } from "../plugins";
import * as utils from "../utils";

export default ({ bot, config }: ModuleProps) => {
	if (!config.enableGreeting) return;

	bot.on(Events.GuildMemberAdd, async (member) => {
		const guild = member.guild;

		const serverGreeting = config.serverGreetings?.[guild.id];
		if (
			!serverGreeting ||
			(!serverGreeting.message && !serverGreeting.attachment)
		)
			return;

		const greetingMessage = utils.readMultilineConfigValue(
			serverGreeting.message || "",
		);

		if (serverGreeting.attachment) {
			const file = await Bun.file(serverGreeting.attachment).arrayBuffer();
			const attachment = new AttachmentBuilder(Buffer.from(file), {
				name: serverGreeting.attachment,
			});

			member.send({
				content: greetingMessage,
				files: [attachment],
			});
		}

		member.send({ content: greetingMessage });
	});
};
