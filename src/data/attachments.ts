import { access } from "node:fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import config from "../cfg";
import * as utils from "../utils";
import { type Attachment, type SendableChannels } from "discord.js";
import { getSelfUrl } from "../utils";
import { unlink } from "node:fs/promises";

const attachmentSavePromises: Record<string, Promise<{ url: string }>> = {};

const attachmentStorageTypes: Record<
  string,
  (attachment: Attachment) => Promise<{ url: string }>
> = {
  original: async (attachment: Attachment) => ({
    url: attachment.url,
  }),
  discord: async (attachment: Attachment) => {
    if (attachment.size > 1024 * 1024 * 8) {
      return getErrorResult("attachment too large (max 8MB)");
    }

    const attachmentChannelId = config.attachmentStorageChannelId;
    const inboxGuild = utils.getInboxGuild();

    const attachmentChannel =
      attachmentChannelId &&
      (await inboxGuild.channels.fetch(attachmentChannelId));
    if (!attachmentChannelId || !attachmentChannel) {
      throw new Error("Attachment storage channel not found!");
    }

    if (!attachmentChannel.isSendable()) {
      throw new Error("Attachment storage channel must be a text channel!");
    }

    const savedAttachment = await createDiscordAttachmentMessage(
      attachmentChannel,
      attachment,
    );
    if (!savedAttachment) return getErrorResult();

    return { url: savedAttachment.url };
  },
  local: async (attachment: Attachment) => {
    const targetPath = getLocalAttachmentPath(attachment.id);

    try {
      // If the file already exists, resolve immediately
      await access(targetPath);
      const url = await getLocalAttachmentUrl(attachment.id, attachment.name);
      return { url };
    } catch (_e) {}

    // Download the attachment
    const downloadResult = await downloadAttachment(attachment);
    console.log(targetPath, downloadResult.path);

    try {
      // Move the temp file to the attachment folder
      await Bun.write(targetPath, Bun.file(downloadResult.path));

      // Clean up the temp file
      await downloadResult.cleanup();
    } catch (error) {
      // Clean up on failure
      await downloadResult.cleanup();
      throw error;
    }

    // Resolve the attachment URL
    const url = await getLocalAttachmentUrl(attachment.id, attachment.name);
    return { url };
  },
};

function getErrorResult(msg?: string) {
  return {
    url: `Attachment could not be saved${msg ? `: ${msg}` : ""}`,
    failed: true,
  };
}

export async function downloadAttachment(attachment: Attachment, tries = 0) {
  if (tries > 3) {
    console.error("Attachment download failed after 3 tries:", attachment);
    throw new Error("Attachment download failed after 3 tries");
  }

  const filepath = join(
    tmpdir(),
    `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  console.log(filepath);

  try {
    const response = await fetch(attachment.url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Write the response directly to file
    await Bun.write(filepath, response);

    return {
      path: filepath,
      cleanup: async () => {
        try {
          await unlink(filepath);
        } catch (err) {
          // File might already be deleted, ignore
        }
      },
    };
  } catch (error) {
    // Clean up failed download
    try {
      await unlink(filepath);
    } catch {
      // Ignore cleanup errors
    }

    console.error("Error downloading attachment, retrying");
    return downloadAttachment(attachment, tries + 1);
  }
}

/**
 * Returns the filesystem path for the given attachment id
 * @param {String} attachmentId
 * @returns {String}
 */
export function getLocalAttachmentPath(attachmentId: string): string {
  return `${config.attachmentDir}/${attachmentId}`;
}

/**
 * Returns the self-hosted URL to the given attachment ID
 */
export function getLocalAttachmentUrl(
  attachmentId: string,
  desiredName?: string,
): Promise<string> {
  if (desiredName == null) desiredName = "file.bin";
  return getSelfUrl(`attachments/${attachmentId}/${desiredName}`);
}

export async function createDiscordAttachmentMessage(
  channel: SendableChannels,
  file: Attachment,
  tries = 0,
) {
  try {
    const attachmentMessage = await channel.send({ files: [file] });
    return attachmentMessage.attachments.first();
  } catch (e: any) {
    if (tries > 3) {
      console.error(
        `Attachment storage message could not be created after 3 tries: ${e.message}`,
      );
      return;
    }

    return createDiscordAttachmentMessage(channel, file, tries + 1);
  }
}

export const saveAttachment = (attachment: Attachment) => {
  if (attachmentSavePromises[attachment.id]) {
    return attachmentSavePromises[attachment.id];
  }

  if (attachmentStorageTypes[config.attachmentStorage]) {
    attachmentSavePromises[attachment.id] = Promise.resolve(
      attachmentStorageTypes[config.attachmentStorage]!(attachment),
    );
  } else {
    throw new Error(
      `Unknown attachment storage option: ${config.attachmentStorage}`,
    );
  }

  attachmentSavePromises[attachment.id]!.then(() => {
    delete attachmentSavePromises[attachment.id];
  });

  return attachmentSavePromises[attachment.id];
};

export function addStorageType(
  name: string,
  handler: (attachment: Attachment) => Promise<{ url: string }>,
) {
  attachmentStorageTypes[name] = handler;
}
