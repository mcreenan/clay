import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InputCapabilities, PromptContent } from "../../shared/protocol";
import { isPromptImage, promptContent } from "../../shared/prompt";

export const EMPTY_INPUT: InputCapabilities = { commands: [], images: false, files: true };

/** Copy files into the receiving agent's workspace, including files sent through a hub. */
export function prepareInput(cwd: string, text: string, content: PromptContent = {}, images = true) {
  const validated = promptContent(content);
  const attachments = validated.attachments ?? [];
  if (!images && attachments.some((a) => isPromptImage(a.mime)))
    throw new Error("This agent does not support image input. Remove the image or select another agent.");
  const pictures = attachments.filter((a) => isPromptImage(a.mime));
  const files = attachments.filter((a) => !isPromptImage(a.mime));
  const paths: string[] = [];
  if (files.length) {
    const dir = path.join(cwd, ".clay", "attachments", randomUUID());
    mkdirSync(dir, { recursive: true });
    for (const [i, a] of files.entries()) {
      const name = path
        .basename(a.name.replace(/\\/g, "/"))
        .replace(/[^\w. -]/g, "_")
        .replace(/^\.+/, "_");
      const file = path.join(dir, `${i + 1}-${name || "attachment"}`);
      writeFileSync(file, Buffer.from(a.base64, "base64"), { flag: "wx" });
      paths.push(file);
    }
  }
  return {
    text: [
      text,
      ...(paths.length ? [`Attached files in your workspace:\n${paths.map((p) => JSON.stringify(p)).join("\n")}`] : []),
    ]
      .filter(Boolean)
      .join("\n\n"),
    pictures,
    command: validated.command,
  };
}
