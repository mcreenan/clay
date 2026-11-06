import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_BYTES,
  type PromptAttachment,
  type PromptContent,
} from "./protocol";

export const isPromptImage = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime);

/** Validate the wire payload before saving it or passing it to a provider. */
export function promptContent(input: PromptContent): PromptContent {
  const attachments = input.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS)
    throw new Error(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
  let total = 0;
  const files: PromptAttachment[] = attachments.map((a) => {
    if (
      !a ||
      typeof a.name !== "string" ||
      !a.name.trim() ||
      a.name.length > 255 ||
      typeof a.mime !== "string" ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(a.mime) ||
      typeof a.base64 !== "string" ||
      !a.base64.length ||
      a.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)
    )
      throw new Error("Invalid attachment. Remove the file and attach it again.");
    const bytes = (a.base64.length / 4) * 3 - (a.base64.endsWith("==") ? 2 : a.base64.endsWith("=") ? 1 : 0);
    if (bytes > MAX_ATTACHMENT_BYTES) throw new Error(`${a.name} exceeds the 10 MB file limit.`);
    total += bytes;
    return { name: a.name, mime: a.mime, base64: a.base64 };
  });
  if (total > MAX_PROMPT_ATTACHMENT_BYTES) throw new Error("Attachments exceed the 20 MB message limit.");
  const command = input.command;
  if (
    command &&
    (typeof command.name !== "string" ||
      typeof command.invocation !== "string" ||
      !/^[/$][\w:.-]+$/.test(command.invocation) ||
      typeof command.description !== "string" ||
      (command.path !== undefined && typeof command.path !== "string"))
  )
    throw new Error("Invalid command. Select the command again.");
  return {
    ...(files.length ? { attachments: files } : {}),
    ...(command
      ? {
          command: {
            name: command.name,
            description: command.description,
            invocation: command.invocation,
            ...(command.path ? { path: command.path } : {}),
          },
        }
      : {}),
  };
}
