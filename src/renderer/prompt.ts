import type { PromptCommand } from "../shared/protocol";

/** Complete a command token at the caret without changing the rest of the prompt. */
export function commandMatches(text: string, caret: number, commands: PromptCommand[]) {
  const match = /(?:^|\s)([/$])([\w:.-]*)$/.exec(text.slice(0, caret));
  if (!match || (match[1] === "/" && text.slice(0, caret - match[0].length).trim())) return;
  const token = match[1] + match[2];
  const search = match[2].toLowerCase();
  const matches = commands.filter((c) => c.name.toLowerCase().includes(search)).slice(0, 40);
  return { start: caret - token.length, end: caret, matches };
}

export function fileMime(file: Pick<File, "name" | "type">) {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const images: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return images[ext ?? ""] ?? "application/octet-stream";
}
