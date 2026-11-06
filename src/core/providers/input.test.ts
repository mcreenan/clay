import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { MAX_ATTACHMENT_BYTES, type PromptAttachment } from "../../shared/protocol";
import { promptContent } from "../../shared/prompt";
import { prepareInput } from "./input";

const dirs: string[] = [];
function workspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clay-input-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const attachment = (name: string, text: string, mime = "text/plain"): PromptAttachment => ({
  name,
  mime,
  base64: Buffer.from(text).toString("base64"),
});

test("files arrive in the receiving workspace with their bytes intact and safe, distinct paths", () => {
  const cwd = workspace();
  const content = { attachments: [attachment("../../report.txt", "first"), attachment("..\\report.txt", "second")] };
  const prepared = prepareInput(cwd, "Read these", content);
  const paths = prepared.text
    .split("\n")
    .filter((line) => line.startsWith('"'))
    .map((line) => JSON.parse(line) as string);
  expect(paths).toHaveLength(2);
  for (const file of paths) expect(file.startsWith(path.join(cwd, ".clay", "attachments") + path.sep)).toBe(true);
  expect(paths.map((file) => readFileSync(file, "utf8"))).toEqual(["first", "second"]);
  const again = prepareInput(cwd, "Read again", content);
  expect(again.text).not.toBe(prepared.text);
  expect(readdirSync(path.join(cwd, ".clay", "attachments"))).toHaveLength(2);
});

test("images stay as native image input and unsupported images fail before files are written", () => {
  const cwd = workspace();
  const image = attachment("image.png", "image bytes", "image/png");
  expect(prepareInput(cwd, "", { attachments: [image] })).toMatchObject({ text: "", pictures: [image] });
  expect(() => prepareInput(cwd, "", { attachments: [attachment("notes.txt", "notes"), image] }, false)).toThrow(
    /does not support image input/,
  );
  expect(readdirSync(cwd)).toEqual([]);
});

test("rejects malformed and excessive payloads before saving a prompt", () => {
  const valid = attachment("file.txt", "file");
  for (const base64 of ["!!!!", "Zg=", "Z===", "=Zg="])
    expect(() => promptContent({ attachments: [{ ...valid, base64 }] })).toThrow(/Invalid attachment/);
  expect(() => promptContent({ attachments: Array.from({ length: 11 }, () => valid) })).toThrow(/up to 10/);
  const large = { ...valid, base64: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64") };
  expect(() => promptContent({ attachments: [large] })).toThrow(/10 MB/);
  const full = { ...valid, base64: Buffer.alloc(MAX_ATTACHMENT_BYTES).toString("base64") };
  expect(() => promptContent({ attachments: [full, full, valid] })).toThrow(/20 MB/);
  expect(promptContent({ attachments: [full, full] }).attachments).toHaveLength(2);
});
