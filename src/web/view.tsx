import type { FC } from "hono/jsx";
import bot from "../bot";
import type { Thread as DBThread } from "../data/Thread";
import type { ThreadMessage as DBThreadMessage } from "../data/ThreadMessage";

const Layout: FC = (props) => {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="/style.css" rel="stylesheet" />
        <title>{props.title}</title>
      </head>
      <body>{props.children}</body>
    </html>
  );
};

export const Thread: FC<{
  thread: DBThread;
  messages: Array<DBThreadMessage>;
}> = async ({ thread, messages }) => {
  // const user = await bot.users.fetch(thread.user_id);

  const data = messages[0]?.body;
  messages = messages.splice(1);

  const messageType = (type_: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) => ({
    1: "System",
    2: "Internal Chat",
    3: "From User",
    4: "ToUser",
    5: "Legacy",
    6: "Command",
    7: "System (To User)",
    8: "Reply Edited",
    9: "Reply Deleted",
  }[type_])

  return (
    <Layout title={`Modmail thread with ${thread.user_name}`}>
      <header class="thread-header">
        <img
          src="https://cdn.discordapp.com/avatars/255432387993796618/5c947997c70c1d3db8b9950db924a25a.png?size=256"
          alt="Modmail Icon"
          width="80px"
        />
        <h1>Thread with {thread.user_name}</h1>
        {/*  TODO: Format creation */}
        <p>Thread opened {thread.created_at.toLocaleString()}.</p>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </header>
      <main class="thread">
        <pre>{JSON.stringify(thread, null, 2)}</pre>
        <ul class="threadMessages">
          {messages.map((msg) => {
            return <li>
              <figure class="msgAvatar"></figure>
              <div class="msgContent">
                <div class="msgHeader">
                  <p data-tooltip={msg.user_id}>
                    {msg.user_name}
                    <Shield />
                    <span class="typeBadge">{messageType(msg.message_type)}</span>
                  </p>
                  <time>{msg.created_at.toLocaleString()}</time></div>
                <div class="msgBody">
                  <p>{msg.body}</p>
                </div>
              </div>
            </li>
          })}
        </ul>
      </main>
    </Layout>
  );
};

const Shield = (props) => {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M15.3296 0H4.6586C4.49194 2.16758 2.65782 3.83491 0.490234 3.83491V4.8353C0.490234 9.75393 2.82462 14.3392 6.90952 17.5905L9.99416 20.008L13.0787 17.5905C17.1637 14.4224 19.498 9.75393 19.498 4.8353V3.83491C17.3304 3.83491 15.5797 2.16758 15.3296 0ZM8.07671 14.4224C5.57566 12.4216 4.07501 9.58726 4.07501 6.50262V5.91902C5.40887 5.91902 6.57606 4.91863 6.65939 3.58477H9.99416V16.0064L8.07671 14.4224Z" />
  </svg>
}

const _extractData = (
  _data: string,
): {
  account_age: number; // duration
  joined: number;
  nickname: string;
} => {
  return {
    account_age: 0,
    joined: 0,
    nickname: "",
  };
};
