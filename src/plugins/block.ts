import type { Message } from "discord.js";
import humanizeDuration from "humanize-duration";
import { utc } from "moment";
import * as blocked from "../data/blocked";
import type Thread from "../data/Thread";
import type { ModuleProps } from "../plugins";
import { getLogChannel, getOrFetchChannel, noop } from "../utils";

export default ({ bot, config, commands }: ModuleProps) => {
	if (!config.allowBlock) return;

	async function removeExpiredBlocks() {
		const expiredBlocks = await blocked.getExpiredBlocks();
		if (expiredBlocks.length === 0) return;

		const logChannel = await getLogChannel();
		for (const userId of expiredBlocks) {
			await blocked.unblock(userId);
			logChannel.send({
				content: `Block of <@!${userId}> (id \`${userId}\`) expired`,
				allowedMentions: {
					users: [userId],
				},
			});
		}
	}

	async function expiredBlockLoop() {
		try {
			await removeExpiredBlocks();
		} catch (e) {
			console.error(e);
		}

		setTimeout(expiredBlockLoop, 2000);
	}

	expiredBlockLoop();

	const blockCmd = async (
		msg: Message,
		args: Record<string, unknown>,
		thread?: Thread,
	) => {
		const userIdToBlock = (args.userId as string) || thread?.user_id;
		if (!userIdToBlock || !msg.channel.isSendable()) return;

		const channel = await getOrFetchChannel(bot, msg.channel.id);
		if (!channel || !channel.isSendable()) return;

		const isBlocked = await blocked.isBlocked(userIdToBlock);
		if (isBlocked) {
			channel.send("User is already blocked");
			return;
		}

		const expiresAt = args.blockTime as number;

		const user = await bot.users.fetch(userIdToBlock);
		await blocked.block(
			userIdToBlock,
			user ? user.username : "",
			msg.author.id,
			expiresAt,
		);

		if (expiresAt) {
			const humanized = humanizeDuration(expiresAt, {
				largest: 2,
				round: true,
			});
			msg.channel.send(
				`Blocked <@${userIdToBlock}> (id \`${userIdToBlock}\`) from modmail for ${humanized}`,
			);

			const timedBlockMessage = config.timedBlockMessage || config.blockMessage;
			if (timedBlockMessage) {
				const formatted = timedBlockMessage
					.replace(/\{duration}/g, humanized)
					.replace(/\{timestamp}/g, utc(expiresAt).format("X"));

				await user.send(formatted).catch(noop);
			}
		} else {
			msg.channel.send(
				`Blocked <@${userIdToBlock}> (id \`${userIdToBlock}\`) from modmail indefinitely`,
			);

			if (config.blockMessage != null) {
				await user.send(config.blockMessage).catch(noop);
			}
		}
	};

	commands.addInboxServerCommand(
		"block",
		"<userId:userId> [blockTime:delay]",
		blockCmd,
	);

	commands.addInboxServerCommand("block", "[blockTime:delay]", blockCmd);

	const unblockCmd = async (
		msg: Message,
		args: Record<string, unknown>,
		thread?: Thread,
	) => {
		const userIdToUnblock = (args.userId as string) || thread?.user_id;
		if (!userIdToUnblock) return;
		if (!msg.channel.isSendable()) return;

		const isBlocked = await blocked.isBlocked(userIdToUnblock);
		if (!isBlocked) {
			msg.channel.send("User is not blocked");
			return;
		}

		const unblockAt = args.unblockDelay as number;

		const user = await bot.users.fetch(userIdToUnblock);
		if (unblockAt) {
			const humanized = humanizeDuration(unblockAt, {
				largest: 2,
				round: true,
			});
			await blocked.updateExpiryTime(userIdToUnblock, unblockAt);
			msg.channel.send(
				`Scheduled <@${userIdToUnblock}> (id \`${userIdToUnblock}\`) to be unblocked in ${humanized}`,
			);

			const timedUnblockMessage =
				config.timedUnblockMessage || config.unblockMessage;
			if (timedUnblockMessage) {
				const formatted = timedUnblockMessage
					.replace(/\{delay}/g, humanized)
					.replace(/\{timestamp}/g, utc(unblockAt).format("X"));
				user.send(formatted).catch(noop);
			}
		} else {
			await blocked.unblock(userIdToUnblock);
			msg.channel.send(
				`Unblocked <@${userIdToUnblock}> (id ${userIdToUnblock}) from modmail`,
			);

			if (config.unblockMessage) {
				user.send(config.unblockMessage).catch(noop);
			}
		}
	};

	commands.addInboxServerCommand(
		"unblock",
		"<userId:userId> [unblockDelay:delay]",
		unblockCmd,
	);
	commands.addInboxServerCommand("unblock", "[unblockDelay:delay]", unblockCmd);

	commands.addInboxServerCommand(
		"is_blocked",
		"[userId:userId]",
		async (msg: Message, args: Record<string, unknown>, thread?: Thread) => {
			const userIdToCheck = args.userId || thread?.user_id;
			if (
				!userIdToCheck ||
				!msg.channel.isSendable() ||
				typeof userIdToCheck !== "string"
			)
				return;

			const blockStatus = await blocked.getBlockStatus(userIdToCheck);
			if (blockStatus.isBlocked) {
				if (blockStatus.expiresAt) {
					msg.channel.send({
						content: `<@!${userIdToCheck}> (id \`${userIdToCheck}\`) is blocked until ${blockStatus.expiresAt} (UTC)`,
						allowedMentions: { users: [userIdToCheck] },
					});
				} else {
					msg.channel.send({
						content: `<@!${userIdToCheck}> (id \`${userIdToCheck}\`) is blocked indefinitely`,
						allowedMentions: { users: [userIdToCheck] },
					});
				}
			} else {
				msg.channel.send({
					content: `<@!${userIdToCheck}> (id \`${userIdToCheck}\`) is NOT blocked`,
					allowedMentions: { users: [userIdToCheck] },
				});
			}
		},
	);

	commands.addInboxServerCommand(
		"blocklist",
		"",
		async (msg, _args, _thread) => {
			const blockedUsers = await blocked.getBlockedUsers();
			if (blockedUsers.length === 0 && msg.channel.isSendable()) {
				msg.channel.send("No users are currently blocked.");
				return;
			}

			let reply = "List of blocked users:\n";
			for (const user of blockedUsers) {
				const userInfo = `**<@!${user.userId}> (id \`${user.userId}\`)** - Blocked by <@${user.blockedBy}>${user.expiresAt ? ` until ${user.expiresAt} (UTC)` : " permanently"}`;
				reply += `${userInfo}\n`;
			}

			msg.channel.isSendable() && msg.channel.send(reply);
		},
	);
};
