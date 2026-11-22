// A mind that zooms (plan 3.2 §6.4, §7.1): a character's own agent starts with the newest of what it perceived whole, within its
// size, a line for what waits, and an outline of the rest of its record with sizes; `self_read` opens the rest, a part at a time,
// for the character the calling agent plays and for no one else, from what the character may know; `cast_query` answers by gist
// for the omniscient side. With no size set and no outline named, a character is handed what it was handed before there were
// sizes. A batch of a take-in (plan 3.2 §6.5) opens by its range of ids, whatever was struck since its plan was read. What is not
// there is answered with as many near matches as the chat's setting says. Played on the cast's invented chat. Every name and every
// word here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TemplatePart } from "../../src/app/guidance";
import type { AgentRef, JsonObject, ToolResult } from "rp-harness/contract";
import type { CastDeps } from "../../src/cast/index";
import { charactersOf, type CastWrite } from "../../src/cast/record";
import { type CastViewInput, type CastViewName, castViews, type Layout } from "../../src/cast/views";
import { CAST_START_DEFAULTS, castClock } from "../../src/cast/kit";
import { takeInViews } from "../../src/cast/take-in";
import { untakenSized } from "../../src/cast/zoom";
import { IFACE_DEFAULTS } from "../../src/iface/kit";
import { isRecord } from "../../src/shared/json";
import { writeStory } from "../../src/story/record";
import type { Store } from "../../src/store";
import { WORLD_STATE_DEFAULTS } from "../../src/store/world-state";
import { scenesAcross } from "../../src/turn/stage";
import { engine, make, tick } from "../store/fixtures";
import { type Bench, CHAT, dataOf, openBench, shippedLayouts, texts, tokensOf, USER, wordsFromFiles } from "./rig";

let layouts: Partial<Record<CastViewName, TemplatePart>> = {};
let dispose = (): void => undefined;

beforeAll(async () => {
  ({ layouts, dispose } = await shippedLayouts());
});

afterAll(() => dispose());

const BRAM: AgentRef = { id: "bram-1", definition: "character", plays: "Bram" };
const WREN: AgentRef = { id: "wren-1", definition: "character", plays: "Wren" };

/** What the omniscient side records of a perception and its character never perceived: each a text no reading of the character's may hold. */
const MISSED = "MISSED-SENTINEL the letter orders the inn seized at dawn";
const VERDICT = "VERDICT-SENTINEL Odile lies to cover her own debt";
const WHY = "WHY-SENTINEL the Author had the hour wrong";
const SENTINELS = [MISSED, VERDICT, WHY];

/** The views the shipped character definition names, and the list it named before the outline. */
const SHIPPED = ["base", "growth", "mind", "what-comes-to-mind", "relationships:present", "unprocessed-perceptions", "outline", "game-side", "imported"];
const BEFORE = SHIPPED.filter((name) => name !== "outline");

const FILLER = "The common room smelled of wet wool and tallow, and nobody at the long table looked up from their bowls. ".repeat(3).trim();
const DAYS = ["Sat 1 Mar 2031", "Sun 2 Mar 2031", "Mon 3 Mar 2031", "Tue 4 Mar 2031"];
/** The two scenes' titles as the Author wrote them: the story record's words, the omniscient side's account of what happened, which no reading of the character's may hold. */
const TITLES = ["TITLE-SENTINEL Odile slips poison into the cup of the reeve", "TITLE-SENTINEL What the cellar hid"];

interface Backlog {
  b: Bench;
  bram: string;
  /** Bram's perceptions, oldest first: three on each of four days, the first two days in one scene and the last two in another. */
  ids: string[];
  /** Odile's one perception. */
  hers: string;
  scenes: string[];
}

/** Bram and Odile cast as principals; four days played, a scene opened on the first and another on the third; three perceptions a day for Bram, each with what the omniscient side alone knows of it. */
async function backlog(more: Partial<CastDeps> = {}): Promise<Backlog> {
  let store: Store | undefined;
  const b = await openBench({ tokens: tokensOf, scenes: ({ user, chat }, at, turns) => (store === undefined ? new Map() : scenesAcross(store, user, chat, at, turns)), ...more });
  store = b.t.store;
  const ids: string[] = [];
  const scenes: string[] = [];
  let hers = "";
  for (const day of [0, 1, 2, 3]) {
    const turn = await b.t.begin();
    if (day === 0) expect((await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "cast", who: "Odile", as: "principal" }] }, turn.id)).error).toBeUndefined();
    if (day > 0) await b.t.writes.run(() => b.t.s.addChanges(turn.id, engine(tick(24 * 60))));
    if (day % 2 === 0) {
      const [scene] = await b.t.writes.run(() => writeStory(b.t.store, { user: USER, chat: CHAT, turn: turn.id, by: "author", agent: "author-1", job: null }, [{ part: "scene", item: null, value: { title: TITLES[day / 2] ?? "" } }]));
      scenes.push(scene?.item ?? "");
    }
    const r = await b.call(
      "perceive",
      {
        perceptions: [0, 1, 2].map((n) => ({
          who: "Bram",
          moment: `Moment ${day}-${n}`,
          reach: "part",
          content: `PERCEIVED-${day}-${n} ${FILLER}`,
          missed: `${MISSED} ${day}-${n}`,
          told_by: "Odile",
          reliability: VERDICT,
          ...(n === 0 ? {} : { knows: [`KNOWN-${day}-${n} the cellar door was bolted from outside.`] }),
        })),
      },
      turn.id,
    );
    expect(r.error).toBeUndefined();
    ids.push(...(dataOf(r).perceptions as JsonObject[]).map((p) => String(p.id)));
    if (day === 0) {
      const odile = await b.call("perceive", { perceptions: [{ who: "Odile", reach: "whole", content: "ODILE-ONLY she hid the cellar key in the flour bin." }] }, turn.id);
      hers = String(((dataOf(odile).perceptions as JsonObject[])[0] as JsonObject).id);
    }
    await b.t.tie(turn);
  }
  // The Author corrects the first perception, and says why: a word for the record, not for Bram.
  const fix = await b.t.begin();
  expect((await b.call("perceive", { perceptions: [{ id: ids[0] ?? "", who: "Bram", moment: "Moment 0-0, corrected", why: WHY }] }, fix.id)).error).toBeUndefined();
  await b.t.tie(fix);
  const bram = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Bram")?.id ?? "";
  return { b, bram, ids, hers, scenes };
}

function input(b: Bench, more: Partial<CastViewInput> = {}): CastViewInput {
  return { store: b.t.store, user: USER, chat: CHAT, turn: null, character: "Bram", present: ["Bram", "Wren"], sources: b.t.shelf.reader, layouts, tokens: tokensOf, scenes: (turns) => scenesAcross(b.t.store, USER, CHAT, null, turns), ...more };
}

/** Bram's own start, at the sizes given over the shipped ones. */
const own = (sizes: Partial<NonNullable<CastViewInput["own"]>> = {}): NonNullable<CastViewInput["own"]> => ({ plays: "Bram", ...CAST_START_DEFAULTS, foldTokens: WORLD_STATE_DEFAULTS.foldTokens, ...sizes });

const view = (views: readonly { name: string; text: string }[], name: string): string => views.find((v) => v.name === name)?.text ?? "";

/** Everything an answer says: its data and its lines. */
const said = (r: ToolResult): string => [...texts(r), ...(r.reports ?? [])].join("\n");

describe("what a character's own agent starts with", () => {
  test("a large backlog: the newest perceptions whole within the size, oldest first, a line for those that wait, and an outline of the rest by day and by scene with sizes", async () => {
    const { b, bram, ids, scenes } = await backlog();
    const views = await castViews(SHIPPED, input(b, { own: own({ newlyPerceivedTokens: 320 }) }));
    const whole = view(views, "unprocessed-perceptions");
    expect(tokensOf(whole)).toBeLessThanOrEqual(320);

    // The newest are whole and in order, each as its layout has always laid one out; the earlier ones wait, counted and sized, with the call that reads them.
    const shown = ids.filter((id) => whole.includes(`[${id}]`));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(ids.length);
    expect(shown).toEqual(ids.slice(ids.length - shown.length));
    expect(whole).toContain(`PERCEIVED-3-2 ${FILLER}`);
    expect(whole).toContain("- What they now know: KNOWN-3-2 the cellar door was bolted from outside.");
    expect(whole).not.toContain("PERCEIVED-0-0");
    const waiting = ids.slice(0, ids.length - shown.length);
    const line = /^Not shown here: (\d+) earlier perceptions, (\d+) tokens, still to be taken in\. self_read reads them whole: part perceptions, id (\S+), to (\S+)\.$/m.exec(whole);
    expect([Number(line?.[1]), line?.[3], line?.[4]]).toEqual([waiting.length, waiting[0], `${waiting.at(-1)}`]);
    // What waits is sized as the helper that lists it sizes it: each perception as its character may read it, whole.
    const sized = untakenSized({ record: b.t.record(), clock: castClock(b.t.store, USER, CHAT, null) }, bram, tokensOf);
    expect(sized.map((p) => p.item.id)).toEqual(ids);
    expect(Number(line?.[2])).toBe(sized.slice(0, waiting.length).reduce((sum, p) => sum + p.tokens, 0));

    // The outline lists what waits, and only that: by day, then by scene, then each perception by its moment and what Bram came to know by it.
    const outline = view(views, "outline");
    const end = waiting.at(-1) ?? "";
    expect(tokensOf(outline)).toBeLessThanOrEqual(1500);
    // His newest are whole beside it, so the call for all that waits ends at the last one that does.
    expect(outline).toStartWith(`### The rest of Bram's record, in outline\n\nPerceived earlier and not yet taken in: ${waiting.length} perceptions, ${line?.[2]} tokens. self_read reads them: part perceptions, to ${end}; with how gist, each by what they came to know by it.\n`);
    expect(outline).toMatch(/^- Sat 1 Mar 2031: 3 perceptions, \d+ tokens\. self_read reads them: part perceptions, day Sat 1 Mar 2031\.$/m);
    expect(outline).toMatch(new RegExp(`^  - Scene ${scenes[0]}: 3 perceptions, \\d+ tokens\\. self_read reads them: part perceptions, day Sat 1 Mar 2031, scene ${scenes[0]}\\.$`, "m"));
    expect(outline).toMatch(new RegExp(`^    - \\[${ids[1]}\\] \\d+ tokens, Moment 0-1: KNOWN-0-1 the cellar door was bolted from outside\\.$`, "m"));
    // A perception that noted nothing learned is listed by its moment alone: nothing of what reached Bram is put in a line.
    expect(outline).toMatch(new RegExp(`^    - \\[${ids[0]}\\] \\d+ tokens, Moment 0-0, corrected$`, "m"));
    for (const id of waiting) expect(outline).toContain(`[${id}]`);
    for (const id of shown) expect(outline).not.toContain(`[${id}]`);
    expect(outline).not.toContain("PERCEIVED-");

    // The day the cut falls in: its line counts the one that waits, and its call ends there, so that it brings that one and not the two Bram holds whole already.
    expect(shown).toEqual(ids.slice(10));
    expect(outline).toMatch(new RegExp(`^- Tue 4 Mar 2031: 1 perception, \\d+ tokens\\. self_read reads them: part perceptions, day Tue 4 Mar 2031, to ${end}\\.$`, "m"));
    expect(outline).toMatch(new RegExp(`^  - Scene ${scenes[1]}: 1 perception, \\d+ tokens\\. self_read reads them: part perceptions, day Tue 4 Mar 2031, scene ${scenes[1]}, to ${end}\\.$`, "m"));
    const brought = dataOf(await b.call("self_read", { part: "perceptions", day: "Tue 4 Mar 2031", scene: scenes[1] ?? "", to: end }, null, BRAM)).perceptions as JsonObject[];
    expect(brought.map((p) => p.id)).toEqual([end]);
    // Each line's size is the size of what its call brings, whole.
    const dayLine = /^- Tue 4 Mar 2031: 1 perception, (\d+) tokens\./m.exec(outline);
    expect(Number(dayLine?.[1])).toBe(tokensOf(JSON.stringify(brought[0])));
  });

  test("the outline keeps to its size: what is not listed is counted in the line above it, and the line for each part stands whatever the size", async () => {
    const { b, ids } = await backlog();
    const at = async (outlineTokens: number): Promise<string> => view(await castViews(["outline"], input(b, { own: own(), settings: { outlineTokens } })), "outline");
    // Named alone, the outline lists every perception that waits: nothing beside it holds any of them whole.
    const all = await at(100_000);
    for (const id of ids) expect(all).toContain(`[${id}]`);
    for (const day of DAYS) expect(all).toContain(`- ${day}: 3 perceptions, `);

    const some = await at(170);
    expect(tokensOf(some)).toBeLessThanOrEqual(170);
    // Nothing is held whole beside it, so what waits is all there is: not "earlier".
    expect(some).toContain("Perceived and not yet taken in: 12 perceptions, ");
    // The newest days are listed first; the days not listed are counted in one line, with the call that reads them and no others.
    const listed = DAYS.filter((day) => some.includes(`- ${day}: `));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(DAYS.length);
    expect(listed).toEqual(DAYS.slice(DAYS.length - listed.length));
    expect(some).not.toContain(`[${ids[0]}]`);
    const older = (DAYS.length - listed.length) * 3;
    expect(some).toMatch(new RegExp(`^- Before the days listed here: ${older} perceptions, \\d+ tokens\\. self_read reads them: part perceptions, to ${ids[older - 1]}\\.$`, "m"));
    const brought = dataOf(await b.call("self_read", { part: "perceptions", to: ids[older - 1] ?? "" }, null, BRAM)).perceptions as JsonObject[];
    expect(brought.map((p) => p.id)).toEqual(ids.slice(0, older));

    // No room at all: nothing is listed, and the one line for each part still says how many it holds, how large they are and the call that reads them.
    const none = await at(0);
    expect(none).toStartWith("### The rest of Bram's record, in outline\n\nPerceived and not yet taken in: 12 perceptions, ");
    expect(none).toMatch(/^Perceived and not yet taken in: 12 perceptions, \d+ tokens\. self_read reads them: part perceptions; with how gist, each by what they came to know by it\.$/m);
    expect(none).toMatch(/^What they know: 8 statements, \d+ tokens\. self_read reads them: part knowledge; with subject and a few words, only those that hold the words\.$/m);
    expect(none).not.toContain("Mar 2031");
    expect(none).not.toContain("[");
  });

  test("a size that holds not even the newest: nothing is cut to fit; every one waits whole, counted with the call that reads them, and the outline lists them", async () => {
    const { b, ids } = await backlog();
    const views = await castViews(["unprocessed-perceptions", "outline"], input(b, { own: own({ newlyPerceivedTokens: 0 }) }));
    const whole = view(views, "unprocessed-perceptions");
    expect(whole).toMatch(new RegExp(`^### What Bram has perceived and not yet taken in\\n\\nNot shown here: 12 perceptions, \\d+ tokens, still to be taken in\\. self_read reads them whole: part perceptions, id ${ids[0]}, to ${ids[11]}\\.$`));
    const outline = view(views, "outline");
    expect(outline).toContain("Perceived and not yet taken in: 12 perceptions, ");
    for (const id of ids) expect(outline).toContain(`[${id}]`);
    // What each holds is one call away, word for word.
    const read = dataOf(await b.call("self_read", { part: "perceptions", id: ids[0] ?? "", to: ids[11] ?? "" }, null, BRAM)).perceptions as JsonObject[];
    expect(read.map((p) => p.content)).toEqual([0, 1, 2, 3].flatMap((day) => [0, 1, 2].map((n) => `PERCEIVED-${day}-${n} ${FILLER}`)));
  });

  test("nothing the omniscient side alone knows reaches the character: not in what it is handed, not in its outline, whatever the layout asks for", async () => {
    const { b } = await backlog();
    const views = await castViews(SHIPPED, input(b, { own: own({ newlyPerceivedTokens: 320 }) }));
    for (const sentinel of SENTINELS) for (const v of views) expect({ view: v.name, holds: v.text.includes(sentinel) }).toEqual({ view: v.name, holds: false });

    // A layout that prints every field it is given is given none of them: the character's copy of a perception is made without them.
    const greedy: Layout = { render: (fields) => ({ text: JSON.stringify(fields) }) };
    const dumped = await castViews(["unprocessed-perceptions", "outline"], input(b, { own: own({ newlyPerceivedTokens: null }), layouts: { "unprocessed-perceptions": greedy, outline: greedy } }));
    expect(view(dumped, "unprocessed-perceptions")).toContain("PERCEIVED-0-0");
    for (const sentinel of SENTINELS) for (const v of dumped) expect({ view: v.name, holds: v.text.includes(sentinel) }).toEqual({ view: v.name, holds: false });
    // What it is given of each: what reached Bram, and which perception it is. No other field of the record is among them, whatever it is called.
    const fields: unknown = JSON.parse(view(dumped, "unprocessed-perceptions"));
    const given = isRecord(fields) && isRecord(fields.perceptions) && Array.isArray(fields.perceptions.items) ? fields.perceptions.items.filter(isRecord) : [];
    expect(given).toHaveLength(12);
    expect([...new Set(given.flatMap((p) => Object.keys(p)))].sort()).toEqual(["content", "date", "id", "knows", "message", "moment", "reach", "told_by"]);
    // The same layout, for anyone else: the record's own fields, as the omniscient side reads them.
    const others = await castViews(["unprocessed-perceptions"], input(b, { layouts: { "unprocessed-perceptions": greedy } }));
    expect(view(others, "unprocessed-perceptions")).toContain(MISSED);
  });

  test("a scene is named to the character by its id, under its day, never by its title: the title is the story record's words, which no reading of the character's holds", async () => {
    const { b, ids, scenes } = await backlog();
    // A start that holds nothing whole: every perception waits, and the outline lays them out by day and by scene.
    const views = await castViews(SHIPPED, input(b, { own: own({ newlyPerceivedTokens: 0 }) }));
    const outline = view(views, "outline");
    expect(outline).toMatch(new RegExp(`^  - Scene ${scenes[0]}: 3 perceptions, \\d+ tokens\\. self_read reads them: part perceptions, day Sat 1 Mar 2031, scene ${scenes[0]}\\.$`, "m"));
    expect(outline).toMatch(new RegExp(`^  - Scene ${scenes[1]}: 3 perceptions, \\d+ tokens\\. self_read reads them: part perceptions, day Mon 3 Mar 2031, scene ${scenes[1]}\\.$`, "m"));
    // A layout that prints every field it is given is given a scene's id, and no title to print.
    const greedy: Layout = { render: (fields) => ({ text: JSON.stringify(fields) }) };
    const dumped = await castViews(["outline"], input(b, { own: own(), layouts: { outline: greedy } }));
    expect(view(dumped, "outline")).toContain(`"id":"${scenes[0]}"`);

    // self_read opens a scene by its id. Asked by its title, or by words no scene has, it says how a scene is asked for, and names the scenes by id alone.
    const byId = await b.call("self_read", { part: "perceptions", scene: scenes[0] ?? "" }, null, BRAM);
    expect((dataOf(byId).perceptions as JsonObject[]).map((p) => p.id)).toEqual(ids.slice(0, 6));
    for (const asked of [TITLES[0] ?? "", "the stables"]) {
      expect(texts(await b.call("self_read", { part: "perceptions", scene: asked }, null, BRAM))).toEqual([`Nothing in perceptions is of the scene ${asked}: a scene is asked for by its id, as your outline names it. The latest scenes it holds: ${scenes[0]}, ${scenes[1]}.`]);
    }
    const answers = [byId, await b.call("self_read", {}, null, BRAM), await b.call("self_read", { part: "perceptions", how: "gist" }, null, BRAM), await b.call("self_read", { part: "perceptions", day: DAYS[2] ?? "" }, null, BRAM)];
    const read = [...views.map((v) => v.text), ...dumped.map((v) => v.text), ...answers.map((r) => said(r))].join("\n");
    expect(TITLES.filter((title) => read.includes(title))).toEqual([]);
  });

  test("with no size set and the list its definition named before, a character is handed what anyone is handed of it: every perception and every old file, whole", async () => {
    const { b, bram } = await backlog();
    const carried: CastWrite[] = [{ character: bram, part: "mind", item: `imported:${bram}:core.md`, value: { kind: "imported", file: "core.md", text: "# Bram\nKeeps the Gilded Hart.", entity: "bram", filed: false } }];
    const turn = await b.t.begin();
    await b.t.write(turn, carried, "migration");
    await b.t.tie(turn);
    const before = await castViews(BEFORE, input(b));
    const now = await castViews(BEFORE, input(b, { own: own({ newlyPerceivedTokens: null, importedTokens: null }) }));
    expect(now).toEqual(before);
    expect(view(now, "unprocessed-perceptions")).toContain("PERCEIVED-0-0");
    expect(view(now, "imported")).toContain("Keeps the Gilded Hart.");
    expect(view(now, "unprocessed-perceptions")).not.toContain("Not shown here");

    // A layout of the user's own that has no line for what waits is given every perception whole, whatever the size: nothing is counted in a line nobody reads.
    const part = layouts["unprocessed-perceptions"];
    const older: Layout = { render: (fields) => part?.render({ ...fields, waiting: undefined }) ?? { text: "" } };
    const [kept] = await castViews(["unprocessed-perceptions"], input(b, { own: own({ newlyPerceivedTokens: 50 }), layouts: { "unprocessed-perceptions": older } }));
    expect(kept?.text).toBe(view(before, "unprocessed-perceptions"));
  });

  test("old mind files: listed by name and size as shipped, whole as far as a size holds, every one whole with none; the outline lists them only where no view beside it does", async () => {
    const { b, bram } = await backlog();
    const core = "# Bram\nKeeps the Gilded Hart.\n\nOwes the reeve two seasons of rent.";
    const plans = "Sell the cellar wine before the tax. ".repeat(30).trim();
    const turn = await b.t.begin();
    await b.t.write(
      turn,
      ["core.md", "plans.md"].map((file): CastWrite => ({ character: bram, part: "mind", item: `imported:${bram}:${file}`, value: { kind: "imported", file, text: file === "core.md" ? core : plans, entity: "bram", filed: false } })),
      "migration",
    );
    await b.t.tie(turn);
    const imported = async (importedTokens: number | null): Promise<string> => view(await castViews(["imported"], input(b, { own: own({ importedTokens }) })), "imported");

    expect(await imported(0)).toBe(
      ["### Bram's old mind files, as they were written", "", `Not shown here: 2 files, ${tokensOf(core) + tokensOf(plans)} tokens. self_read reads one whole: part imported, name and the file's name.`, `- core.md: ${tokensOf(core)} tokens`, `- plans.md: ${tokensOf(plans)} tokens`].join("\n"),
    );
    // A size that holds the first and not the second: the first whole, the second listed.
    const some = await imported(100);
    expect(tokensOf(some)).toBeLessThanOrEqual(100);
    expect(some).toContain(`#### core.md\n\n${core}`);
    expect(some).toContain(`Not shown here: 1 file, ${tokensOf(plans)} tokens.`);
    expect(some).not.toContain("Sell the cellar wine");
    const every = await imported(null);
    expect(every).toBe(view(await castViews(["imported"], input(b)), "imported"));
    expect(every).toContain(plans);

    // Beside the `imported` view the outline says nothing of them; alone, it lists them as the briefing's own list does.
    const beside = view(await castViews(["imported", "outline"], input(b, { own: own() })), "outline");
    expect(beside).not.toContain("core.md");
    const alone = view(await castViews(["outline"], input(b, { own: own() })), "outline");
    expect(alone).toContain(`Their old mind files, not yet filed: 2 files, ${tokensOf(core) + tokensOf(plans)} tokens. self_read reads one: part imported, name and the file's name.\n- core.md: ${tokensOf(core)} tokens\n- plans.md: ${tokensOf(plans)} tokens`);

    // The character opens one by its name, word for word; a name that is none of theirs is answered with those that wait.
    const read = await b.call("self_read", { part: "imported", name: "core" }, null, BRAM);
    expect(dataOf(read)).toEqual({ imported: [{ file: "core.md", text: core }] });
    const none = await b.call("self_read", { part: "imported", name: "diary.md" }, null, BRAM);
    expect(none.error).toBe(true);
    expect(texts(none)).toEqual(["You carry no old mind file diary.md that waits to be filed. Those that wait: core.md, plans.md."]);
    const gist = dataOf(await b.call("self_read", { part: "imported", how: "gist" }, null, BRAM)).imported as JsonObject[];
    expect(gist).toEqual([
      { file: "core.md", first: "# Bram", tokens: tokensOf(core) },
      { file: "plans.md", text: plans, tokens: tokensOf(plans) },
    ]);
  });

  test("the game side closes what is large of it, as the world state closes a thing that holds much: what is on them by name, the values by count, each with its size; a layout with no folded part closes nothing", async () => {
    const b = await openBench({ tokens: tokensOf });
    const turn = await b.t.begin();
    expect((await b.call("cast_update", { operations: [{ op: "cast", who: "Wren", as: "principal" }] }, turn.id)).error).toBeUndefined();
    await b.t.writes.run(() => b.t.s.addChanges(turn.id, engine(make("lantern", "Storm lantern", "wren"), make("rope", "Coil of rope", "wren"))));
    await b.t.tie(turn);
    const side = async (more: Partial<CastViewInput>): Promise<string> => view(await castViews(["game-side"], input(b, { character: "Wren", ...more })), "game-side");
    const whole = await side({});
    expect(whole).toContain("On them:\n- ");
    expect(whole).toContain("- Storm lantern (");
    expect(whole).toContain("As the world state has them:\n- tier: Leads");
    // Under the size, her own agent is handed all of it, as anyone is.
    expect(await side({ own: { ...own(), plays: "Wren" } })).toBe(whole);

    const folded = await side({ own: { ...own({ foldTokens: 20 }), plays: "Wren" } });
    expect(folded).toMatch(/^On them, by name: Coil of rope, Coin purse, Grey cloak, Satchel, Storm lantern\. 5 in all, \d+ tokens with what each is, not shown here\.$/m);
    expect(folded).toMatch(/^As the world state has them: \d+ values, \d+ tokens, not shown here\.$/m);
    expect(folded).toEndWith("self_read reads all of it: part game-side.");
    expect(folded).not.toContain("- tier: Leads");
    expect(folded).toContain("Where: The Common Room, ");
    // For anyone else it is whole whatever the size, and so it is by a layout that has no folded part, and for her own agent where its start sets no size (an agent with no self_read to open it).
    expect(await side({ own: own({ foldTokens: 20 }) })).toBe(whole);
    const part = layouts["game-side"];
    const older: Layout = { render: (fields) => part?.render({ ...fields, folded: undefined }) ?? { text: "" } };
    expect(await side({ own: { ...own({ foldTokens: 20 }), plays: "Wren" }, layouts: { "game-side": older } })).toBe(whole);
    expect(await side({ own: { ...own({ foldTokens: null }), plays: "Wren" } })).toBe(whole);

    // Her own reading opens all of it, and by gist gives it by name and count.
    const all = dataOf(await b.call("self_read", { part: "game-side" }, null, WREN))["game-side"] as JsonObject;
    expect((all.holds as JsonObject[]).map((thing) => thing.name)).toEqual(["Coil of rope", "Coin purse", "Grey cloak", "Satchel", "Storm lantern"]);
    expect((all.values as JsonObject[]).some((v) => v.key === "coin")).toBe(true);
    const brief = await b.call("self_read", { part: "game-side", how: "gist" }, null, WREN);
    expect(wordsFromFiles(brief)).toBe(true);
    expect(dataOf(brief)["game-side"]).toMatchObject({ on: ["Coil of rope", "Coin purse", "Grey cloak", "Satchel", "Storm lantern"], values: { count: (all.values as JsonObject[]).length } });
    // The world holds no one by Hale's name: said so, in the answers' words.
    await b.call("cast_update", { operations: [{ op: "cast", who: "Hale", as: "principal" }] }, null);
    expect(texts(await b.call("self_read", { part: "game-side" }, null, { id: "hale-1", definition: "character", plays: "Hale" }))).toEqual(["The world holds no person you are: none is tied to you, and your name finds no one, or more than one."]);
  });
});

describe("self_read", () => {
  /** The fields a perception may have, as its character reads it. */
  const OWN_FIELDS = ["content", "date", "id", "knows", "message", "moment", "reach", "told_by"];

  test("opens a day's perceptions whole, and a scene's, and a range of ids, each as it reached the character and none with what the omniscient side alone knows", async () => {
    const { b, ids, scenes } = await backlog();
    const day = await b.call("self_read", { part: "perceptions", day: "sun 2 mar 2031" }, null, BRAM);
    expect(day.error).toBeUndefined();
    expect(wordsFromFiles(day)).toBe(true);
    const read = dataOf(day).perceptions as JsonObject[];
    expect(read.map((p) => p.id)).toEqual(ids.slice(3, 6));
    expect(read[1]).toEqual({ id: ids[4] ?? "", moment: "Moment 1-1", reach: "part", content: `PERCEIVED-1-1 ${FILLER}`, knows: ["KNOWN-1-1 the cellar door was bolted from outside."], told_by: "Odile", message: 3, date: "Sun 2 Mar 2031, 8:00 AM" });
    for (const p of read) expect(Object.keys(p).filter((key) => !OWN_FIELDS.includes(key))).toEqual([]);

    const scene = dataOf(await b.call("self_read", { part: "perceptions", scene: scenes[1] ?? "" }, null, BRAM)).perceptions as JsonObject[];
    expect(scene.map((p) => p.id)).toEqual(ids.slice(6));
    expect(dataOf(await b.call("self_read", { part: "perceptions", scene: scenes[0] ?? "", day: DAYS[1] ?? "" }, null, BRAM)).perceptions).toEqual(read);
    const range = dataOf(await b.call("self_read", { part: "perceptions", id: ids[2] ?? "", to: ids[4] ?? "" }, null, BRAM)).perceptions as JsonObject[];
    expect(range.map((p) => p.id)).toEqual(ids.slice(2, 5));
    // The first, as the Author corrected it: the moment as now recorded, and nothing of why.
    const [first] = dataOf(await b.call("self_read", { part: "perceptions", id: ids[0] ?? "" }, null, BRAM)).perceptions as JsonObject[];
    expect(first).toMatchObject({ id: ids[0] ?? "", moment: "Moment 0-0, corrected" });

    // Every reading of the part, whole and by gist, with a subject and with none: no word of what Bram missed, of the verdict on who told him, or of the Author's reason.
    for (const args of [{ part: "perceptions" }, { part: "perceptions", how: "gist" }, { part: "perceptions", subject: "cellar door" }, { part: "perceptions", subject: "sentinel" }, {}] as JsonObject[]) {
      const r = await b.call("self_read", args, null, BRAM);
      expect(wordsFromFiles(r)).toBe(true);
      for (const sentinel of SENTINELS) expect({ args, holds: said(r).includes(sentinel) }).toEqual({ args, holds: false });
    }
    // The omniscient side still reads all of it.
    const authors = said(await b.call("cast_query", { who: "Bram", part: "perceptions" }, null));
    for (const sentinel of SENTINELS) expect(authors).toContain(sentinel);
  });

  test("acts for the character the calling agent plays and for no one else: asked of another, by an agent that plays nobody, or for an id that is another's, it answers with why not", async () => {
    const { b, ids, hers } = await backlog();
    const other = await b.call("self_read", { who: "Odile", part: "perceptions" }, null, BRAM);
    expect(other.error).toBe(true);
    expect(texts(other)).toEqual(["self_read reads your own record and nobody else's: you are Bram, and you asked for Odile. What you know of anyone else is what your own memories, relationships and knowledge hold of them."]);
    // Someone the cast does not hold is answered the same way: it says nothing of who exists.
    expect(texts(await b.call("self_read", { who: "Nobody at all" }, null, BRAM))[0]).toStartWith("self_read reads your own record and nobody else's: you are Bram, and you asked for Nobody at all.");
    // Naming itself changes nothing.
    expect((dataOf(await b.call("self_read", { who: "bram", part: "perceptions", id: ids[0] ?? "" }, null, BRAM)).perceptions as JsonObject[])[0]?.id).toBe(ids[0] ?? "");

    const nobody = await b.call("self_read", { part: "perceptions" }, null);
    expect(nobody.error).toBe(true);
    expect(texts(nobody)).toEqual(["self_read is a character's own, and this agent plays no one."]);

    // Odile's perception, by its id: one Bram does not have, with the nearest of his own and no word of hers.
    const theirs = await b.call("self_read", { part: "perceptions", id: hers }, null, BRAM);
    expect(theirs.error).toBe(true);
    expect(texts(theirs)[0]).toStartWith(`You have no "${hers}" in perceptions. The nearest you have: `);
    expect(said(theirs)).not.toContain("ODILE-ONLY");
    for (const r of [await b.call("self_read", { part: "perceptions" }, null, BRAM), await b.call("self_read", { part: "perceptions", subject: "flour bin" }, null, BRAM)]) expect(said(r)).not.toContain("ODILE-ONLY");
    // And Odile's own agent reads hers.
    expect(said(await b.call("self_read", { part: "perceptions" }, null, { id: "odile-1", definition: "character", plays: "Odile" }))).toContain("ODILE-ONLY she hid the cellar key in the flour bin.");
  });

  test("by gist gives each memory by the gist its own agent wrote, with the size of the whole, and says how much it shows of how much; a memory's whole is read by its id", async () => {
    const { b } = await backlog();
    const turn = await b.t.begin();
    const long = "The reeve's man stood in my doorway with rain running off his hat.\nHe did not come in. He counted the casks from where he stood, twice, and wrote the number down.";
    const made = await b.call("remember", { memories: [{ text: long, gist: "The reeve's man counted my casks.", weight: 3, who: ["the reeve"] }, { text: "Wren paid in old coin.", gist: "Old coin.", who: ["Wren"] }] }, turn.id, BRAM);
    await b.t.tie(turn);
    const [first, second] = (dataOf(made).memories as JsonObject[]).map((m) => String(m.id));

    const r = await b.call("self_read", { part: "memories", how: "gist" }, null, BRAM);
    expect(wordsFromFiles(r)).toBe(true);
    const gists = dataOf(r).memories as JsonObject[];
    const wholes = dataOf(await b.call("self_read", { part: "memories" }, null, BRAM)).memories as JsonObject[];
    expect(gists.map((g) => [g.id, g.gist, g.tokens])).toEqual([
      [first, "The reeve's man counted my casks.", tokensOf(JSON.stringify(wholes[0]))],
      [second, "Old coin.", tokensOf(JSON.stringify(wholes[1]))],
    ]);
    for (const g of gists) expect(g.text).toBeUndefined();
    // The whole's size is each entry's own, added up: the measure the outline's lines count by.
    expect(texts(r).at(-1)).toBe(`These are 2 gists: what your record holds that stands for each entry. This shows ${tokensOf(JSON.stringify(gists))} tokens of ${wholes.reduce((sum, whole) => sum + tokensOf(JSON.stringify(whole)), 0)}; tokens is the size of each whole. self_read with the same part and an id reads one whole.`);
    expect(wholes[0]).toMatchObject({ id: first, text: long, gist: "The reeve's man counted my casks.", tier: "short" });

    // By who a memory is about, and by its tier; a perception that holds no line of what was learned is given by the first line of what reached him, and the answer says that is no gist.
    expect((dataOf(await b.call("self_read", { part: "memories", name: "wren" }, null, BRAM)).memories as JsonObject[]).map((m) => m.id)).toEqual([second]);
    expect(texts(await b.call("self_read", { part: "memories", tier: "long" }, null, BRAM))).toEqual(["You hold nothing in memories that matches."]);
    const perceived = await b.call("self_read", { part: "perceptions", day: DAYS[0] ?? "", how: "gist" }, null, BRAM);
    expect((dataOf(perceived).perceptions as JsonObject[]).map((p) => [p.knows ?? null, p.content ?? null])).toEqual([[null, `PERCEIVED-0-0 ${FILLER}`], [["KNOWN-0-1 the cellar door was bolted from outside."], null], [["KNOWN-0-2 the cellar door was bolted from outside."], null]]);
  });

  test("reads the other parts of its own record: how it feels about people, what it knows, its history; says what a part is not read by; and gives every part with its size when none is named", async () => {
    const { b, ids, scenes } = await backlog();
    const turn = await b.t.begin();
    expect((await b.call("relate", { relationships: [{ with: "Wren", text: "She pays on time.", trust: 40 }, { with: "Hale", text: "A cheat with a badge.\nHe has never once paid for his ale.", fear: 10 }] }, turn.id, BRAM)).error).toBeUndefined();
    expect((await b.call("cast_update", { operations: [{ op: "history", who: "Bram", text: "Took the inn over from his aunt." }, { op: "knowledge", who: "Bram", text: "The reeve's seal has a chipped corner.", how: "He saw it on the letter.", why: WHY }] }, turn.id)).error).toBeUndefined();
    await b.t.tie(turn);

    expect(dataOf(await b.call("self_read", { part: "relationships", name: "hale" }, null, BRAM)).relationships).toEqual([expect.objectContaining({ with: "Hale", text: "A cheat with a badge.\nHe has never once paid for his ale.", fear: 10 })]);
    expect((dataOf(await b.call("self_read", { part: "relationships", how: "gist" }, null, BRAM)).relationships as JsonObject[]).map((g) => [g.with, g.text ?? null, g.first ?? null])).toEqual([["Wren", "She pays on time.", null], ["Hale", null, "A cheat with a badge."]]);
    const known = dataOf(await b.call("self_read", { part: "knowledge", subject: "chipped seal" }, null, BRAM)).knowledge as JsonObject[];
    expect(known).toEqual([expect.objectContaining({ text: "The reeve's seal has a chipped corner.", how: "He saw it on the letter." })]);
    expect(JSON.stringify(known)).not.toContain(WHY);
    // What the perceptions gave him to know is his knowledge too, each statement with who told him.
    expect((dataOf(await b.call("self_read", { part: "knowledge", subject: "KNOWN-2-1" }, null, BRAM)).knowledge as JsonObject[])[0]).toMatchObject({ text: "KNOWN-2-1 the cellar door was bolted from outside.", told_by: "Odile" });
    expect(dataOf(await b.call("self_read", { part: "history" }, null, BRAM)).history).toEqual([expect.objectContaining({ text: "Took the inn over from his aunt." })]);

    const stray = await b.call("self_read", { part: "history", scene: scenes[0] ?? "" }, null, BRAM);
    expect(stray.error).toBe(true);
    expect(texts(stray)).toEqual(["history is not read by scene. It is read by id, to, day, subject, skip."]);
    expect(texts(await b.call("self_read", { part: "game-side", name: "coin" }, null, BRAM))).toEqual(["game-side is not read by name. It is read whole, or with how gist."]);
    expect(texts(await b.call("self_read", { part: "perceptions", day: "Fri 7 Mar 2031" }, null, BRAM))[0]).toStartWith("Nothing in perceptions is of Fri 7 Mar 2031. The nearest days it holds: ");
    expect(texts(await b.call("self_read", { part: "perceptions", scene: "The harbour" }, null, BRAM))).toEqual([`Nothing in perceptions is of the scene The harbour: a scene is asked for by its id, as your outline names it. The latest scenes it holds: ${scenes[0]}, ${scenes[1]}.`]);

    const index = await b.call("self_read", {}, null, BRAM);
    expect(wordsFromFiles(index)).toBe(true);
    const parts = dataOf(index).parts as JsonObject[];
    expect(parts.map((p) => [p.part, p.count])).toEqual([["perceptions", ids.length], ["imported", 0], ["memories", 0], ["relationships", 2], ["knowledge", 9], ["history", 1], ["game-side", 1]]);
    for (const p of parts) expect({ part: p.part, sized: typeof p.tokens === "number" }).toEqual({ part: p.part, sized: Number(p.count) > 0 });
  });

  test("an answer that is not everything it matched says how much more there is and the call that reads on; a perception taken in is no longer read; a question's reader is handed the character's own answer", async () => {
    const { b, ids } = await backlog({ settings: { queryItems: 5 } });
    const first = await b.call("self_read", { part: "perceptions" }, null, BRAM);
    expect((dataOf(first).perceptions as JsonObject[]).map((p) => p.id)).toEqual(ids.slice(0, 5));
    expect(texts(first).at(-1)).toMatch(/^7 more match, \d+ tokens whole\. Ask again with skip 5 to read on, or narrow what you ask for\.$/);
    expect((dataOf(await b.call("self_read", { part: "perceptions", skip: 10 }, null, BRAM)).perceptions as JsonObject[]).map((p) => p.id)).toEqual(ids.slice(10));

    // Bram takes the first two in: they are his memories' now, and the tool says so of each by its id.
    const turn = await b.t.begin();
    expect((await b.call("remember", { memories: [{ text: "The door was bolted from outside.", gist: "Bolted in.", from: [ids[0] ?? ""] }, { taken: [ids[1] ?? ""] }] }, turn.id, BRAM)).error).toBeUndefined();
    await b.t.tie(turn);
    const taken = await b.call("self_read", { part: "perceptions", id: ids[1] ?? "" }, null, BRAM);
    expect(taken.error).toBe(true);
    expect(texts(taken)).toEqual([`${ids[1]} is taken in already and is not read again here: whatever you kept of it is in your memories, and recall brings those back.`]);
    expect((dataOf(await b.call("self_read", { part: "perceptions", to: ids[3] ?? "" }, null, BRAM)).perceptions as JsonObject[]).map((p) => p.id)).toEqual(ids.slice(2, 4));

    // Asked with a question, the reader is handed what the tool would have answered, whole, and the caller its answer alone.
    const tool = b.tools.get("self_read");
    const handed: { name: string; text: string }[] = [];
    const answer = await tool?.run({ part: "perceptions", day: DAYS[3] ?? "", question: "Who bolted the door?" }, {
      scope: { user: USER, chat: CHAT, session: "s-1" },
      agent: BRAM,
      run: "run-1",
      callId: "call-q",
      signal: new AbortController().signal,
      onUpdate: () => undefined,
      reader: async (_question, sources) => {
        handed.push(...sources);
        return { content: [{ type: "text", text: "READER-ANSWER nobody he saw." }] };
      },
    });
    expect(answer?.content).toEqual([{ type: "text", text: "READER-ANSWER nobody he saw." }]);
    expect(handed).toHaveLength(1);
    expect(handed[0]?.text).toContain(`PERCEIVED-3-2 ${FILLER}`);
    for (const sentinel of SENTINELS) expect(handed[0]?.text).not.toContain(sentinel);
    // With no reader to hand it to, it says so.
    expect(texts(await b.call("self_read", { part: "perceptions", question: "Who bolted the door?" }, null, BRAM))).toEqual(["self_read handed your question to nobody: a question is answered by a reader, and you are given none (a reader has none of its own). Call it again without the question and read the answer yourself."]);
  });
});

describe("cast_query by gist", () => {
  test("gives each entry by what the record holds that stands for it, with the size of the whole, and says how much it shows of how much", async () => {
    const { b, ids } = await backlog();
    const r = await b.call("cast_query", { who: "Bram", part: "perceptions", how: "gist" }, null);
    expect(r.error).toBeUndefined();
    expect(wordsFromFiles(r)).toBe(true);
    const gists = dataOf(r).perceptions as JsonObject[];
    const wholes = dataOf(await b.call("cast_query", { who: "Bram", part: "perceptions" }, null)).perceptions as JsonObject[];
    expect(gists.map((g) => g.id)).toEqual(ids);
    expect(gists[1]).toEqual({ id: ids[1] ?? "", moment: "Moment 0-1", message: 1, knows: ["KNOWN-0-1 the cellar door was bolted from outside."], tokens: tokensOf(JSON.stringify(wholes[1])) });
    expect(gists[0]).toMatchObject({ id: ids[0] ?? "", content: `PERCEIVED-0-0 ${FILLER}` });
    expect(JSON.stringify(gists)).not.toContain(MISSED);
    expect(texts(r).at(-1)).toBe(`These are 12 gists: what the record holds that stands for each entry. This shows ${tokensOf(JSON.stringify(gists))} tokens of ${wholes.reduce((sum, whole) => sum + tokensOf(JSON.stringify(whole)), 0)}; tokens is the size of each whole. cast_query with the same who and part and no how reads them whole, and words narrows it.`);

    // A how it does not take is answered with those it does; with none, the answer is as it was.
    const odd = await b.call("cast_query", { who: "Bram", part: "perceptions", how: "part" }, null);
    expect(odd.error).toBe(true);
    expect(texts(odd)).toEqual(['how cannot be read: you sent "part". It is one of: gist, whole.']);
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "perceptions", how: "whole" }, null))).toEqual(dataOf(await b.call("cast_query", { who: "Bram", part: "perceptions" }, null)));
  });
});

describe("a batch of a take-in", () => {
  test("opens by its range of ids: an end struck after the plan was read still bounds the batch, and what is untaken inside it is given; a batch with nothing left says so", async () => {
    const { b, ids } = await backlog();
    const name = `unprocessed-perceptions[${ids[2]}..${ids[4]}]`;
    const batch = (): string => takeInViews([name], input(b), { perceptions: layouts["unprocessed-perceptions"] })[0]?.text ?? "";
    const held = (text: string): string[] => ids.filter((id) => text.includes(`[${id}]`));
    expect(batch()).toContain(`The batch ${ids[2]}..${ids[4]}: 3 of its perceptions not yet taken in, oldest first.`);
    expect(held(batch())).toEqual(ids.slice(2, 5));

    // The Author strikes the batch's first perception, then its last, after the plan was read: what is left between them is still the batch's.
    for (const [struck, left] of [[ids[2], ids.slice(3, 5)], [ids[4], ids.slice(3, 4)]] as const) {
      const turn = await b.t.begin();
      expect((await b.call("perceive", { perceptions: [{ id: struck ?? "", who: "Bram", drop: true, why: "It did not happen so." }] }, turn.id)).error).toBeUndefined();
      await b.t.tie(turn);
      expect(batch()).toContain(`The batch ${ids[2]}..${ids[4]}: ${left.length} of its perceptions not yet taken in, oldest first.`);
      expect(held(batch())).toEqual([...left]);
    }

    // Bram takes in the one left: the batch says every perception of it has been taken in.
    const turn = await b.t.begin();
    expect((await b.call("remember", { memories: [{ text: "The door was bolted from outside.", gist: "Bolted in.", from: [ids[3] ?? ""] }] }, turn.id, BRAM)).error).toBeUndefined();
    await b.t.tie(turn);
    expect(batch()).toBe(`### What Bram has perceived and not yet taken in\n\nEvery perception of the batch ${ids[2]}..${ids[4]} has been taken in.`);
  });
});

describe("near matches", () => {
  test("self_read and cast_query list as many near matches as the chat's setting says (engine.nearMatches), and none at 0", async () => {
    /** What each answers for a day, a scene, an id and a name that are not there, at a number of near matches. */
    const asked = async (nearMatches: number): Promise<{ scenes: string[]; said: string[] }> => {
      const { b, scenes } = await backlog({ near: { nearMatches, nearDistance: IFACE_DEFAULTS.nearDistance } });
      const first = async (name: string, args: JsonObject, agent?: AgentRef): Promise<string> => texts(await b.call(name, args, null, agent))[0] ?? "";
      return { scenes, said: [await first("self_read", { part: "perceptions", day: "Fri 7 Mar 2031" }, BRAM), await first("self_read", { part: "perceptions", scene: "The harbour" }, BRAM), await first("self_read", { part: "perceptions", id: "p-999" }, BRAM), await first("cast_query", { who: "Brahm" })] };
    };
    const one = await asked(1);
    expect(one.said[0]).toMatch(/^Nothing in perceptions is of Fri 7 Mar 2031\. The nearest days it holds: [^,]+\.$/);
    expect(one.said[1]).toBe(`Nothing in perceptions is of the scene The harbour: a scene is asked for by its id, as your outline names it. The latest scenes it holds: ${one.scenes[1]}.`);
    expect(one.said[2]).toMatch(/^You have no "p-999" in perceptions\. The nearest you have: [^,]+\.$/);
    expect(one.said[3]).toBe("There is no Brahm in the cast; the nearest names are Bram.");
    expect((await asked(0)).said).toEqual(["Nothing in perceptions is of Fri 7 Mar 2031.", "Nothing in perceptions is of the scene The harbour: a scene is asked for by its id, as your outline names it.", 'You have no "p-999" in perceptions.', "There is no Brahm in the cast."]);
  });
});
