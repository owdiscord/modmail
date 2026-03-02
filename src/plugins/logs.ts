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
import { getUserThreadsClosedCount } from "../data/threads";
import type { SQL } from "bun";
import bot from "../bot";

const LOG_LINES_PER_PAGE = 12;

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

    const totalUserThreads = await threads.getClosedThreadCountByUserId(
      db,
      userId,
      new Date(),
    );

    if (totalUserThreads === 0) {
      channel.send({ content: `**There are no log files for <@${userId}>**` });
      return;
    }

    const userThreads = await threads.getClosedThreadsByUserId(
      db,
      userId,
      args.page as number,
      LOG_LINES_PER_PAGE,
    );

    const container = await logsComponent(
      totalUserThreads,
      userThreads,
      parseInt(args.page as string, 10) || 1,
      user.displayName,
      user.id,
    );

    channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
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

    const threadNumber = await getUserThreadsClosedCount(
      db,
      thread.user_id,
      thread.created_at,
    );

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
        `Loglink for thread #${threadNumber + 1} with **${thread.user_name}**\n<${addOptQueryStringToUrl(logUrl, qs)}>`,
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
  ]);

  channel.send({
    embeds: [embed],
  });
}

export async function logsComponent(
  totalUserThreads: number,
  threads: Array<Thread>,
  page: number,
  username: string,
  userId: string,
): Promise<ContainerBuilder> {
  const pages = Math.ceil(totalUserThreads / LOG_LINES_PER_PAGE);

  const threadLines = (
    await Promise.all(
      threads.map(async (userThread) => {
        const logUrl = await getSelfUrl(`logs/${userThread.id}`);
        const startOfId = userThread.id.split("-")[0];

        return `- [\`#${startOfId}\`](${logUrl}) <t:${Math.round(userThread.created_at.getTime() / 1000)}:R>`;
      }),
    )
  ).join("\n");

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Threads with ${username}**\n-# \`${userId}\``,
      ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(threadLines));

  if (pages > 1) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Page ${page || 1} / ${pages}`),
      )
      .addActionRowComponents((actionRow) =>
        actionRow.setComponents(
          new ButtonBuilder()
            .setLabel("Newer")
            .setDisabled(page === 1)
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`logs/${userId}/${page - 1}`),
          new ButtonBuilder()
            .setLabel("Older")
            .setDisabled(page === pages)
            .setStyle(ButtonStyle.Secondary)
            .setCustomId(`logs/${userId}/${page + 1}`),
        ),
      );
  }

  return container;
}

export async function handleLogPageChange(
  db: SQL,
  userId: string,
  displayName: string,
  page: number,
) {
  const totalUserThreads = await threads.getClosedThreadCountByUserId(
    db,
    userId,
    new Date(),
  );

  const userThreads = await threads.getClosedThreadsByUserId(
    db,
    userId,
    page,
    LOG_LINES_PER_PAGE,
  );

  const container = await logsComponent(
    totalUserThreads,
    userThreads,
    page,
    displayName,
    userId,
  );

  return container;
}
