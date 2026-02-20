import { access, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attachment, SendableChannels } from "discord.js";
import { getSelfUrl } from "../utils";

async function saveLocalAttachment(attachment: Attachment): Promise<string> {
  const targetPath = getLocalAttachmentPath(attachment.id);

  try {
    // If the file already exists, resolve immediately
    await access(targetPath);
    const url = await getLocalAttachmentUrl(attachment.id, attachment.name);
    return url;
  } catch (_e) {}

  // Download the attachment
  const downloadResult = await downloadAttachment(attachment);

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
  return url;
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
        } catch (_err) {
          // File might already be deleted, ignore
        }
      },
    };
  } catch (_error) {
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

export function getLocalAttachmentPath(attachmentId: string): string {
  return `attachments/${attachmentId}`;
}

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
  } catch (e: unknown) {
    if (tries > 3) {
      if (e instanceof Error)
        console.error(
          `Attachment storage message could not be created after 3 tries: ${e.message}`,
        );
      else
        console.error(
          `Attachment storage message could not be created after 3 tries: ${e}`,
        );

      return;
    }

    return createDiscordAttachmentMessage(channel, file, tries + 1);
  }
}

export const saveAttachment = saveLocalAttachment;
