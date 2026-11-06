import { expect, test } from "vite-plus/test";
import { commandMatches } from "./prompt";

const commands = [
  { name: "review", invocation: "/review", description: "Review the code" },
  {
    name: "skill-creator",
    invocation: "$skill-creator",
    description: "Create a skill",
    path: "/skills/creator/SKILL.md",
  },
];

test("slash completion finds skills and commands, and replaces only the token at the caret", () => {
  expect(commandMatches("/sk and keep this", 3, commands)).toEqual({ start: 0, end: 3, matches: [commands[1]] });
  expect(commandMatches("Use $sk here", 7, commands)).toEqual({ start: 4, end: 7, matches: [commands[1]] });
  expect(commandMatches("/REV", 4, commands)?.matches).toEqual([commands[0]]);
});

test("ordinary file paths and completed tokens do not open command suggestions", () => {
  for (const text of ["Read /tmp", "https://example.com", "/review ", "ordinary text"])
    expect(commandMatches(text, text.length, commands)).toBeUndefined();
});
