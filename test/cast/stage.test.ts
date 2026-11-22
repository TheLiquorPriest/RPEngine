// What is given of those on stage: a character's game side, as the world state holds the person they
// are; and the Author's views of everyone on stage, as the guidance names them (a principal's history,
// a supporting character's old mind files). Every name and word here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TemplatePart } from "../../src/app/guidance";
import type { JsonValue } from "rp-harness/contract";
import { charactersOf } from "../../src/cast/record";
import { type CastViewInput, type CastViewName, castPresentViews, castViews } from "../../src/cast/views";
import { type Bench, CHAT, openBench, shippedLayouts, tokensOf, USER } from "./rig";

let layouts: Partial<Record<CastViewName, TemplatePart>> = {};
let dispose = (): void => undefined;

beforeAll(async () => {
  ({ layouts, dispose } = await shippedLayouts());
});

afterAll(() => dispose());

function input(b: Bench, present: string[] = [], turn: string | null = null): Omit<CastViewInput, "character"> {
  return { store: b.t.store, user: USER, chat: CHAT, turn, present, sources: b.t.shelf.reader, layouts, tokens: tokensOf };
}

/** Bram and Wren cast as principals, Odile as supporting, Hale (whom the world does not hold) as an extra, in one played turn, with what the Author recorded of their story. */
async function cast(b: Bench): Promise<string> {
  const turn = await b.t.begin();
  const beat = await b.t.beat(turn, "The inn changes hands.", "years ago");
  const r = await b.call(
    "cast_update",
    {
      operations: [
        { op: "cast", who: "Bram", as: "principal" },
        { op: "cast", who: "Wren", as: "principal" },
        { op: "cast", who: "Odile", as: "supporting" },
        { op: "cast", who: "Hale", as: "extra", line: "A watchman." },
        { op: "history", who: "Bram", text: "Took the inn over from his mother.", beats: [beat] },
        { op: "history", who: "Odile", text: "Came down from the hills with nothing." },
      ],
    },
    turn.id,
  );
  expect(r.error).toBeUndefined();
  await b.t.tie(turn);
  return beat;
}

describe("a character's game side", () => {
  test("is the world state's person by the character's name: where they are, what is on them, and each value the state keeps; it follows the path", async () => {
    const b = await openBench();
    await cast(b);
    const side = async (): Promise<string> => (await castViews(["game-side"], { ...input(b), character: "Wren" }))[0]?.text ?? "";
    expect(await side()).toBe(
      [
        "### Wren in the world (entity:wren)",
        "",
        "Where: The Common Room, The Lamp and Ladle, Thornbury, Hollow Vale",
        "",
        "On them:",
        "- Coin purse (Container)",
        "- Grey cloak (Item)",
        "- Satchel (Container)",
        "",
        "As the world state has them:",
        "- tier: Leads",
        "- coin: $12.00",
        "- place: common_room",
        "- home: lamp_ladle",
        "- description: A courier with mud on her boots.",
        "- owner: bram",
        "- law: the watch's rules",
        "- curfew: midnight",
        "- region: region_vale",
        "- currency: USD ($)",
      ].join("\n"),
    );

    // A move recorded on a turn moves her game side; a swipe of that turn moves it back.
    const turn = await b.t.begin();
    const move = { type: "set", entity: "wren", field: "place", value: "cellar" };
    await b.t.writes.run(() => b.t.s.addChanges(turn.id, [{ lane: "engine", op: "set", value: move as unknown as JsonValue }]));
    const moved = await b.t.tie(turn);
    expect(await side()).toContain("Where: The Cellar, The Lamp and Ladle, Thornbury, Hollow Vale");
    await b.t.tie(await b.t.swipe());
    expect(await side()).toContain("Where: The Common Room, The Lamp and Ladle");
    await b.t.showSwipe(moved);
    expect(await side()).toContain("Where: The Cellar,");
  });

  test("there is none for a character the world holds no one by", async () => {
    const b = await openBench();
    await cast(b);
    expect(charactersOf(b.t.db, USER, [CHAT]).map((c) => c.name)).toContain("Hale");
    expect(await castViews(["game-side"], { ...input(b), character: "Hale" })).toEqual([{ name: "game-side", text: "" }]);
  });
});

describe("the Author's views of those on stage", () => {
  test("each view the guidance names, of everyone on stage or of those cast so, one character after another in the stage's order; someone off stage is not given", async () => {
    const b = await openBench();
    const beat = await cast(b);
    const turn = await b.t.begin();
    const odile = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Odile")?.id ?? "";
    await b.t.write(turn, [{ character: odile, part: "mind", item: `imported:${odile}:core.md`, value: { kind: "imported", file: "core.md", text: "Odile. Keeps the cellar key.", entity: "odile", filed: false } }], "migration");
    await b.t.tie(turn);

    const BRAM = `### Bram's history in the story\n- Took the inn over from his mother. (Sat 1 Mar 2031, 8:00 AM) (beat ${beat}, years ago)`;
    const ODILE = "### Odile's history in the story\n- Came down from the hills with nothing. (Sat 1 Mar 2031, 8:00 AM)";
    expect(await castPresentViews(["history:principal", "imported:supporting", "history", "lore:map", "history:hero"], input(b, ["Odile", "Bram", "Wren", "Tam"]))).toEqual([
      { name: "history:principal", text: BRAM },
      { name: "imported:supporting", text: "### Odile's old mind files, as they were written\n\n#### core.md\n\nOdile. Keeps the cellar key." },
      { name: "history", text: `${ODILE}\n\n${BRAM}` },
    ]);
    expect(await castPresentViews(["history:principal"], input(b, ["Odile"]))).toEqual([{ name: "history:principal", text: "" }]);
  });

  test("the outlines the briefing lists: a principal's history newest first as far as the outline's size holds, the earlier entries counted with their size and the call that reads them; a supporting character's old mind files by name and size, with none of their text", async () => {
    const b = await openBench();
    const beat = await cast(b);
    const turn = await b.t.begin();
    const more = Array.from({ length: 30 }, (_, i) => ({ op: "history", who: "Bram", text: `Fixture year ${i + 1}: Bram mends the roof again and counts the casks before the first frost.` }));
    expect((await b.call("cast_update", { operations: more }, turn.id)).error).toBeUndefined();
    const odile = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Odile")?.id ?? "";
    const old = "Odile. Keeps the cellar key. ".repeat(40).trim();
    await b.t.write(turn, [{ character: odile, part: "mind", item: `imported:${odile}:core.md`, value: { kind: "imported", file: "core.md", text: old, entity: "odile", filed: false } }], "migration");
    await b.t.tie(turn);
    const named = ["history-outline:principal", "imported-outline:supporting"];
    const on = (settings: CastViewInput["settings"]) => castPresentViews(named, { ...input(b, ["Odile", "Bram"]), settings });

    // Room for all of it: every entry whole, oldest first, as the whole view has them, and nothing counted.
    const [whole] = await on({ outlineTokens: 100_000 });
    const [history] = await castPresentViews(["history:principal"], input(b, ["Odile", "Bram"]));
    expect(whole?.text).toBe(history?.text ?? "");
    expect(whole?.text).toContain(`- Took the inn over from his mother. (Sat 1 Mar 2031, 8:00 AM) (beat ${beat}, years ago)`);

    // A small outline: the newest entries whole and in order, the earlier ones counted, within the size.
    const [short, files] = await on({ outlineTokens: 300 });
    const lines = (short?.text ?? "").split("\n");
    expect(lines[0]).toBe("### Bram's history in the story");
    const counted = /^(\d+) earlier entries, (\d+) tokens, not shown here\. cast_query reads them: who Bram, part history\.$/.exec(lines[2] ?? "");
    const shown = lines.filter((l) => l.startsWith("- "));
    expect(Number(counted?.[1]) + shown.length).toBe(31);
    expect(shown.length).toBeGreaterThan(3);
    expect(shown.at(-1)).toStartWith("- Fixture year 30:");
    expect(shown[0]).toStartWith(`- Fixture year ${31 - shown.length}:`);
    expect(Number(counted?.[2])).toBeGreaterThan(Number(counted?.[1]) * 10);
    expect(tokensOf(short?.text ?? "")).toBeLessThanOrEqual(300);

    // Odile's old file is listed by its name and size; its words are not here.
    expect(files?.text).toBe(`### Odile's old mind files, not yet filed\n- core.md: ${tokensOf(old)} tokens\n\nThey stand whole, word for word, in this turn's folder: cast/Odile/imported.md.`);
  });
});
