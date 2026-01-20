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
	const user = await bot.users.fetch(thread.user_id);

	const data = messages[0]?.body;
	messages = messages.splice(1);

	return (
		<Layout title={`Modmail thread with ${thread.user_name}`}>
			<header class="thread-header">
				<img
					src="https://cdn.discordapp.com/avatars/255432387993796618/5c947997c70c1d3db8b9950db924a25a.png?size=256"
					alt="Modmail Icon"
					width="80px"
				/>
				<h1>Thread with {thread.user_name}</h1>
				<p>This is the start of the #graphiteisaac channel.</p>
				<pre>{JSON.stringify(data, null, 2)}</pre>
			</header>
			<main class="thread">
				<h1>Thread #{thread.id}</h1>
				<pre>{JSON.stringify(thread, null, 2)}</pre>
				<pre>{JSON.stringify(user, null, 2)}</pre>
				<ul>
					{messages.map((msg) => {
						return <li>{JSON.stringify(msg, null, 2)}</li>;
					})}
				</ul>
			</main>
		</Layout>
	);
};

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
