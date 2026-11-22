// `world_query` says how much it shows (plan 3.2 §7.1): an answer that is not everything beneath its point ends with how many tokens it
// shows of how many and the call that reads the rest; `how` names one end of the depth where no depth is said (gist: the point alone;
// whole: everything beneath it), and a depth said holds. Every name here is made up.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ToolResult } from "rp-harness/contract";
import { Lines, SHIPPED_GUIDANCE } from "../../src/iface/index";
import { rig, texts, wordsFromFiles } from "./rig";

const lines = Lines.parse(await Bun.file(join(SHIPPED_GUIDANCE, ".prompts", "engine-answers.md")).text(), "engine-answers");

/** A counter as the turn gives one: the chat's characters to a token. */
const tokens = (text: string): number => Math.ceil(text.length / 4);

/** The line that says how much an answer shows, where it has one. */
const shownOf = (r: ToolResult): string | undefined => texts(r).find((x) => x.startsWith("This shows "));

describe("world_query says how much it shows of how much", () => {
  test("an answer short of everything beneath its point ends with its size against the whole's and the call that reads all of it; the whole says nothing of the kind", async () => {
    const t = await rig({ tokens });
    const full = await t.call("world_query", { at: "thornbury", depth: "full" });
    expect(full.error).toBeUndefined();
    expect(shownOf(full)).toBeUndefined();
    const whole = texts(full)[0] ?? "";

    const top = await t.call("world_query", { at: "thornbury", depth: 0 });
    expect(top.error).toBeUndefined();
    wordsFromFiles(top);
    const shown = texts(top)[0] ?? "";
    expect(shown.length).toBeLessThan(whole.length);
    expect(shownOf(top)).toBe(lines.line("shown_of", { at: "Thornbury [thornbury]", id: "thornbury", shown: tokens(shown), whole: tokens(whole) }) ?? "none");
  });

  test("how names one end of the depth where none is said, a depth said holds over it, and how takes gist or whole and nothing else", async () => {
    const t = await rig({ tokens });
    const tree = async (args: Record<string, string | number>): Promise<string> => texts(await t.call("world_query", { at: "thornbury", ...args }))[0] ?? "";
    expect(await tree({ how: "gist" })).toBe(await tree({ depth: 0 }));
    expect(await tree({ how: "whole" })).toBe(await tree({ depth: "full" }));
    expect(await tree({ how: "whole", depth: 0 })).toBe(await tree({ depth: 0 }));
    const refused = await t.call("world_query", { at: "thornbury", how: "part" });
    expect(refused.error).toBe(true);
    expect(texts(refused)[0]).toBe('how cannot be read: you sent "part". It is one of: gist, whole.');
  });

  test("with no counter given, an answer says no size", async () => {
    const t = await rig({});
    expect(shownOf(await t.call("world_query", { at: "thornbury", depth: 0 }))).toBeUndefined();
  });
});
