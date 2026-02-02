import { escapeMarkdown, type Message } from "discord.js";
import {
	createUserNote,
	deleteNote,
	findNote,
	findNotesByUserId,
} from "../data/notes";
import type { ModuleProps } from "../plugins";
import {
	chunkMessageLines,
	END_CODEBLOCK,
	postError,
	START_CODEBLOCK,
} from "../utils";

export default ({ config, commands }: ModuleProps) => {
	if (!config.allowNotes) return;

	async function userNotesCmd(msg: Message, userId: string) {
		if (!msg.channel.isSendable()) return;
		const userNotes = await findNotesByUserId(userId);
		if (!userNotes.length) {
			msg.channel.send({
				content: `There are no notes for <@!${userId}>`,
				allowedMentions: {},
			});
			return;
		}

		for (const userNote of userNotes) {
			const timestamp = Math.round(userNote.created_at.getTime() / 1000);
			const content = [
				`Set by <@!${userNote.author_id}> at <t:${timestamp}:f>:`,
				`${START_CODEBLOCK}${escapeMarkdown(userNote.body)}${END_CODEBLOCK}`,
				`*Delete with \`${config.prefix}delete_note ${userNote.id}\`*\n`,
			].join("\n");
			const chunks = chunkMessageLines(content);
			for (const chunk of chunks) {
				await msg.channel.send({
					content: chunk,
					// Make sure we don't ping every note author
					allowedMentions: {},
				});
			}
		}
	}

	commands.addInboxServerCommand("notes", "<userId:userId>", (msg, args) => {
		return userNotesCmd(msg, args.userId as string);
	});

	commands.addInboxThreadCommand("notes", "", (msg, _args, thread) => {
		if (!thread) return;

		return userNotesCmd(msg, thread.user_id);
	});

	async function addUserNoteCmd(msg: Message, userId: string, body: string) {
		if (!msg.channel.isSendable()) return;

		const authorId = msg.author.id;

		await createUserNote(userId, authorId, body);

		await msg.channel.send({
			content: `Note added for <@!${userId}>`,
			allowedMentions: {},
		});
	}

	commands.addInboxServerCommand(
		"note",
		"<userId:userId> <body:string$>",
		(msg, args) => {
			return addUserNoteCmd(msg, args.userId as string, args.body as string);
		},
	);
	commands.addInboxThreadCommand(
		"note",
		"<body:string$>",
		(msg, args, thread) => {
			if (!thread) return;
			return addUserNoteCmd(msg, thread.user_id, args.body as string);
		},
	);

	async function deleteUserNoteCmd(msg: Message, noteId: string) {
		if (!msg.channel.isSendable()) return;

		const note = await findNote(noteId);
		if (!note) {
			postError(msg.channel, "Note not found!");
			return;
		}

		await deleteNote(noteId);
		await msg.channel.send(
			`Deleted note on <@!${note.user_id}>:\n${START_CODEBLOCK}${escapeMarkdown(note.body)}${END_CODEBLOCK}`,
		);
	}

	commands.addInboxServerCommand(
		"delete_note",
		"<noteId:number>",
		(msg, args) => {
			return deleteUserNoteCmd(msg, args.noteId as string);
		},
		{
			aliases: ["deletenote", "delnote"],
		},
	);
};
