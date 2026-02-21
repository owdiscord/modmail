import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  type Message,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { ThreadStatus } from "../data/constants";
import { getLogUrl } from "../data/logs";
import type Thread from "../data/Thread";
import * as threads from "../data/threads";
import type { ModuleProps } from "../plugins";
import { Emoji } from "../style";
import { getSelfUrl } from "../utils";

const LOG_LINES_PER_PAGE = 10;

export default ({ db, commands }: ModuleProps) => {
  const addOptQueryStringToUrl = (
    url: string,
    args: { verbose: boolean; simple: boolean },
  ) => {
    const params = [];
    if (args.verbose) params.push("verbose=1");
    if (args.simple) params.push("simple=1");

    if (params.length === 0) {
      return url;
    }

    const hasQueryString = url.indexOf("?") > -1;
    return url + (hasQueryString ? "&" : "?") + params.join("&");
  };

  const logsCmd = async (
    msg: Message,
    args: Record<string, unknown>,
    thread?: Thread,
  ) => {
    const userId = (args.userId as string) || thread?.user_id;
    if (!userId) return;

    const user = await msg.client.users.fetch(userId);
    if (!user) return;

    const channel = await msg.channel.fetch();
    if (!channel || !channel.isSendable()) return;

    let userThreads = await threads.getClosedThreadsByUserId(
      db,
      userId,
      args.page as number,
      LOG_LINES_PER_PAGE,
    );

    if (userThreads.length === 0) {
      channel.send({ content: `**There are no log files for <@${userId}>**` });
      return;
    }

    // Pagination
    const totalUserThreads = userThreads.length;
    const maxPage = Math.ceil(totalUserThreads / LOG_LINES_PER_PAGE);
    const inputPage = args.page as string;
    const page = Math.max(
      Math.min(inputPage ? parseInt(inputPage, 10) : 1, maxPage),
      1,
    );
    const isPaginated = totalUserThreads > LOG_LINES_PER_PAGE;
    // const start = (page - 1) * LOG_LINES_PER_PAGE;
    // const end = page * LOG_LINES_PER_PAGE;
    userThreads = userThreads.slice(
      (page - 1) * LOG_LINES_PER_PAGE,
      page * LOG_LINES_PER_PAGE,
    );

    const threadLines = (
      await Promise.all(
        userThreads.map(async (userThread) => {
          const logUrl = await getSelfUrl(`logs/${userThread.id}`);
          const startOfId = userThread.id.split("-")[0];

          return `${Emoji.Thread} [\`#${startOfId}\`](${logUrl}) <t:${Math.round(userThread.created_at.getTime() / 1000)}:R>`;
        }),
      )
    ).join("\n");

    const embed = new EmbedBuilder();
    embed.setAuthor({
      name: user.displayName,
      iconURL: user.avatarURL() || user.defaultAvatarURL,
      url: `https://discord.com/users/${user.id}`,
    });
    embed.setDescription(
      `${threadLines}${isPaginated ? "\n\nUse `!logs <num>` to see next page" : ""}`,
    );
    embed.setFooter({
      text: `Page ${page} / ${maxPage}`,
    });

    const components = [
      new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Most recent threads with ${user.displayName}**`,
          ),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(threadLines),
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Page 1 / 3"),
        )
        .addActionRowComponents((actionRow) =>
          actionRow.setComponents(
            new ButtonBuilder()
              .setLabel("Prev")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
              .setCustomId("logsBefore"),
            new ButtonBuilder()
              .setLabel("Next")
              .setDisabled(false)
              .setStyle(ButtonStyle.Secondary)
              .setCustomId("logsAfter"),
          ),
        ),
    ];

    channel.send({
      components,
      flags: MessageFlags.IsComponentsV2,
    });

    // const sent = await channel.send({ embeds: [embed] });
    // sent.react("⬅️");
    // sent.react("➡️");
  };

  const logCmd = async (
    msg: Message,
    args: Record<string, unknown>,
    _thread?: Thread,
  ) => {
    const threadId = args.threadId || _thread?.id;
    if (!threadId) return;

    const thread =
      (await threads.findById(db, threadId as string)) ||
      (await threads.findByThreadNumber(db, threadId as number));
    if (!thread) return;

    const channel = await msg.channel.fetch();

    if (!channel || !channel.isSendable()) return;

    const logUrl = await getLogUrl(thread);
    if (logUrl) {
      const qs = { verbose: false, simple: false };

      if (args.simple && typeof args.simple === "boolean")
        qs.simple = args.simple;

      if (args.verbose && typeof args.verbose === "boolean")
        qs.verbose = args.verbose;

      channel.send(
        `Open the following link to view the log for thread #${thread.thread_number}:\n<${addOptQueryStringToUrl(logUrl, qs)}>`,
      );
      return;
    }

    if (thread.status === ThreadStatus.Open) {
      channel.send(
        `This thread's logs are not currently available, but it's open at <#${thread.channel_id}>`,
      );
      return;
    }

    channel.send("This thread's logs are not currently available");
  };

  const logCmdOptions = [
    { name: "verbose", shortcut: "v", isSwitch: true },
    { name: "simple", shortcut: "s", isSwitch: true },
  ];

  commands.addInboxServerCommand(
    "logs",
    "<userId:userId> [page:number]",
    logsCmd,
    { options: logCmdOptions },
  );
  commands.addInboxServerCommand("logs", "[page:number]", logsCmd, {
    options: logCmdOptions,
  });

  // Add these two overrides to allow using the command in suspended threads
  commands.addInboxThreadCommand("log", "", logCmd, {
    options: logCmdOptions,
    allowSuspended: true,
  });
  commands.addInboxThreadCommand("loglink", "", logCmd, {
    options: logCmdOptions,
    allowSuspended: true,
  });

  commands.addInboxServerCommand("log", "<threadId:string>", logCmd, {
    options: logCmdOptions,
  });
  commands.addInboxServerCommand("loglink", "<threadId:string>", logCmd, {
    options: logCmdOptions,
  });
  commands.addInboxServerCommand(
    "thread",
    [
      {
        name: "thread",
        type: "string",
        required: false,
      },
    ],
    async (msg, args, thread) => {
      if (!thread && !args.thread) return;

      if (/^\d+$/.test(args.thread as string)) {
        const found = await threads.getThreadByNumber(
          db,
          parseInt(args.thread as string, 10),
        );
        if (found) thread = found;
      }

      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          args.thread as string,
        )
      ) {
        const found = await threads.getThreadById(db, args.thread as string);
        if (found) thread = found;
      }

      if (!thread) {
        if (msg.channel.isSendable())
          msg.channel.send(
            "Could not find a thread matching that ID or thread number.",
          );
        else console.error(`Could not find a thread matching ${args.thread}`);

        return;
      }

      threadInfoCmd(msg, thread);
    },
    {},
  );
};

async function threadInfoCmd(msg: Message, thread: Thread) {
  const channel = await msg.channel.fetch();
  if (!channel || !channel.isSendable()) return;

  const embed = new EmbedBuilder();
  embed.setTitle(`Thread with ${thread.user_name}`);
  embed.setDescription(
    `\`${thread.id}\`\n\n[${Emoji.Docs} Read Log link](${await getLogUrl(thread)})`,
  );
  embed.setTimestamp(thread.created_at);
  embed.addFields([
    {
      name: "User name",
      value: `\`${thread.user_name}\``,
      inline: true,
    },
    {
      name: "User ID",
      value: `\`${thread.user_id}\``,
      inline: true,
    },
    // {
    // name: "Thread number",
    // value: `${thread.thread_number.toString()} (deprecated)`,
    // inline: true,
    // },
  ]);

  channel.send({
    embeds: [embed],
  });
}
