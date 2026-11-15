import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export async function downloadBasicAvatar(
  snowflake: string,
  avatar_hash: string,
) {
  const url = `https://cdn.discordapp.com/avatars/${snowflake}/${avatar_hash}.png`;
  const resp = await fetch(url);

  if (!resp.ok || !resp.body)
    throw `Failed to fetch avatar for ${snowflake}: ${resp.status} ${resp.statusText}`;

  const dest = join(import.meta.dirname, "../../avatars", `${snowflake}.png`);

  // delete file if it already exists
  await unlink(dest).catch(() => {});

  await pipeline(resp.body, createWriteStream(dest));
}
