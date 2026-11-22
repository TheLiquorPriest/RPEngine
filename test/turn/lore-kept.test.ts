// The lore a scene's prompts hold, turn against turn (plan 3.2 §6.1, §6.2), played through the stand-in
// Lumiverse: each turn's prompt is compared with the turn before it on its path, so the lore map and the
// scene's own list (`ACTIVATED-LORE.md`, in the session's cache) say of each entry whether it is new,
// changed, as it was or gone, and what the Author did with it; each entry's text is written once, by RPH,
// in the file the list names; and where the user lets the Author's choice stand, a turn starts with what
// it let go as its lines. Then the comparison itself, on lists made by hand. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { Scope, TraceRecord } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import type { TurnLoreReply } from "../../src/shared/api";
import type { TurnRow } from "../../src/store";
import { TURN_FILES } from "../../src/turn/folder";
import { ACTIVATED_LORE_FILE, goneSince, type HeldLore, leadChoices, type SceneKept, sceneOf, sceneRead, standingLetGo } from "../../src/turn/lore-kept";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

const OIL = "Whale oil is kept in the cellar under the lamp room, six barrels, the oldest nearest the door.";
const BELL = "The fog bell hangs in the gallery and is rung by hand, twice a minute, whenever the horn fails.";
const BELL_CHANGED = "The fog bell hangs in the gallery; since the autumn a clockwork striker rings it.";
const GULLS = "Gulls nest on the seaward ledge from April, and no keeper climbs there while they sit.";

/** The keeper's book, attached to the chat: three entries, each activated by its one key. */
function keepersBook(b: TurnBed): void {
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-keep", "Keeper's Book", USER);
  const entry = (id: string, uid: string, key: string, content: string, title: string): void => {
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", id, "wb-keep", uid, JSON.stringify([key]), content, title);
  };
  entry("wbe-oil", "1", "oil", OIL, "The oil store");
  entry("wbe-bell", "2", "bell", BELL, "The fog bell");
  entry("wbe-gull", "3", "gulls", GULLS, "The gulls' ledge");
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: ["wb-keep"] }), CHAT);
}

async function play(b: TurnBed, type: "normal" | "swipe", said?: string): Promise<TurnRow> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return await settledTurn(b, out.generationId!);
}

/** The turn's scope, its folder and its session's cache folder, as agents read them. */
async function placesOf(b: TurnBed, turn: string): Promise<{ scope: Scope & { turn: string }; folder: string; cache: string }> {
  const session = b.turns.runs.record(USER, turn)?.session ?? "";
  const scope = { user: USER, chat: CHAT, session, turn };
  const places = await b.turns.files.places(scope);
  return { scope, folder: places.turn ?? "", cache: `${places.session}cache/` };
}

async function fileText(b: TurnBed, scope: Scope, path: string): Promise<string> {
  const read = await b.turns.files.read(scope, path);
  expect(read.status).toBe("read");
  return read.status === "read" ? read.text : "";
}

/** A request as one text, for what it holds: its line ends as line ends, so that a line of the lore map is a line here. */
const sent = (request: unknown): string => JSON.stringify(request).replaceAll("\\n", "\n");

/** The lore map's id of the entry titled so, as a request's lore map writes it. */
function idOf(request: unknown, title: string): string {
  const id = new RegExp(`\\[(e-\\d+)\\] ${title}`).exec(sent(request))?.[1];
  expect(id).toBeDefined();
  return id!;
}

/** The Author's first answer of a turn: its intent, then one `window` call that lets go of the entry titled so. */
const lettingGo =
  (title: string): Answer =>
  (request) => ({ pieces: [{ text: "<intent>One exchange about the stores.</intent>" }, { call: "window", args: { let_go: [{ name: `lore:${idOf(request, title)}` }] } }] });
const REPLY: Answer = { pieces: [{ text: "<reply>Wren points down the stairs.</reply>" }] };

/** The scene's list as a turn left it in the session's cache. */
const sceneList = async (b: TurnBed, turn: string): Promise<string> => {
  const { scope, cache } = await placesOf(b, turn);
  return fileText(b, scope, `${cache}${ACTIVATED_LORE_FILE}`);
};

/** The line of the list for the entry of this id, and the file it names. */
function lineOf(list: string, id: string): { line: string; file: string } {
  const line = list.split("\n").find((l) => l.startsWith(`- [${id}] `)) ?? "";
  expect(line).not.toBe("");
  return { line, file: /: (\S+\.md)$/.exec(line)?.[1] ?? "" };
}

describe("the lore a scene's prompts hold, turn against turn", () => {
  test("three turns of one scene: each entry is told as new, changed, as last turn or gone, the scene's list names each one's file, and the Author's choice stands where the user lets it", async () => {
    const b = await bed({ answers: [lettingGo("The fog bell"), REPLY, replying("The ledge is white with them."), replying("A striker, now.")], global: "lore:\n  choiceStands: true\n" });
    keepersBook(b);

    // The first turn: the oil and the bell activate. Nothing is before it to compare with. The Author lets the bell go.
    const first = await play(b, "normal", "I ask where the oil is kept, and who rings the bell.");
    const [oil, bell] = [idOf(b.model.requests[0], "The oil store"), idOf(b.model.requests[0], "The fog bell")];
    expect(b.requests[0]?.letGo).toBeUndefined();
    for (const text of [OIL, BELL]) expect(sent(b.model.requests[0])).toContain(text);
    const map1 = sent(b.model.requests[0]);
    // The lore map says of no entry how it stands (the Author's own instructions speak of the words; a line says them in brackets).
    for (const said of ["(new this turn)", "(as last turn)", "### In last turn's prompt"]) expect(map1).not.toContain(said);
    expect(map1).toMatch(new RegExp(`\\[${oil}\\] The oil store, \\d+ tokens`));

    const list1 = await sceneList(b, first.id);
    expect(list1).toContain("## In this turn's prompt (2)");
    expect(list1).not.toContain("## In an earlier prompt");
    const oilLine = lineOf(list1, oil);
    expect(oilLine.line).toMatch(/^- \[e-\d+\] The oil store, from Keeper's Book, \d+ tokens, by a key: \S+\.md$/);
    // The file the list names holds the entry's text, written by RPH in the session's cache; the turn's own lore file names it and holds no text.
    const { scope: scope1, folder: folder1, cache } = await placesOf(b, first.id);
    expect(oilLine.file.startsWith(cache)).toBe(true);
    expect(await fileText(b, scope1, oilLine.file)).toBe(OIL);
    const bellFile1 = lineOf(list1, bell).file;
    expect(await fileText(b, scope1, bellFile1)).toBe(BELL);
    const turnFile = await fileText(b, scope1, `${folder1}${TURN_FILES.lore}`);
    expect(turnFile).toContain("# Lore map");
    expect(turnFile).toContain(`- [${oil}] The oil store, from Keeper's Book, activated by keyword`);
    expect(turnFile).toContain(oilLine.file);
    expect(turnFile).toContain(`${cache}${ACTIVATED_LORE_FILE}`);
    for (const text of [OIL, BELL]) expect(turnFile).not.toContain(text);

    // The second turn: the oil's key is said no more, the gulls' is. The bell stands as it was, and the Author let it go: it starts as its line.
    b.db.run("UPDATE world_book_entries SET key = ?, revision = revision + 1 WHERE id = ?", JSON.stringify(["tar"]), "wbe-oil");
    const calls = b.model.requests.length;
    const second = await play(b, "normal", "I ask whether the gulls mind the bell.");
    const opening2 = b.model.requests[calls];
    const gulls = idOf(opening2, "The gulls' ledge");
    expect(b.requests[1]?.letGo).toEqual([`lore:${bell}`]);
    const text2 = sent(opening2);
    expect(text2).toContain(GULLS);
    expect(text2).not.toContain(BELL);
    expect(text2).toContain(`[Let go: lore:${bell}, `);
    expect(text2).toMatch(new RegExp(`\\[${bell}\\] The fog bell, \\d+ tokens[^\\n]*\\(as last turn\\) \\(you let it go last turn, and it starts this turn let go, as its line\\)`));
    expect(text2).toMatch(new RegExp(`\\[${gulls}\\] The gulls' ledge, \\d+ tokens[^\\n]*\\(new this turn\\)`));
    expect(text2).toMatch(new RegExp(`### In last turn's prompt, not in this one\\n\\n- \\[${oil}\\] The oil store, \\d+ tokens`));

    const list2 = await sceneList(b, second.id);
    expect(list2).toContain("## In this turn's prompt (2)");
    expect(list2).toContain("## In an earlier prompt of this scene, not in this one (1)");
    expect(lineOf(list2, bell).line).toContain("; as last turn; let go by the Author when a prompt last held it: ");
    expect(lineOf(list2, bell).file).toBe(bellFile1);
    expect(lineOf(list2, gulls).line).toContain("; new this turn: ");
    expect(lineOf(list2, oil).line).toContain("; it left with this turn; kept whole by the Author when a prompt last held it: ");

    // The Turn page reads the same of the second turn, with what its own lead did by its end: the bell stayed let go.
    const rows = (await b.page<TurnLoreReply>("GET", `/api/v1/chats/${CHAT}/turns/${second.id}/lore`)).body.entries;
    expect(rows.map((r) => [r.id, r.status, r.lead, typeof r.tokens])).toEqual([
      [bell, "same", "let_go", "number"],
      [gulls, "new", "kept", "number"],
    ]);

    // The third turn: the bell's text changed, so it starts whole whatever the Author did with it; the gulls stand, kept; the oil left a turn ago.
    b.db.run("UPDATE world_book_entries SET content = ?, revision = revision + 1 WHERE id = ?", BELL_CHANGED, "wbe-bell");
    const calls3 = b.model.requests.length;
    const third = await play(b, "normal", "I listen for the bell over the gulls.");
    expect(b.requests[2]?.letGo).toBeUndefined();
    const text3 = sent(b.model.requests[calls3]);
    expect(text3).toContain(BELL_CHANGED);
    expect(text3).toMatch(new RegExp(`\\[${bell}\\] The fog bell, \\d+ tokens[^\\n]*\\(its text changed since last turn\\) \\(you let it go last turn\\)`));
    expect(text3).toMatch(new RegExp(`\\[${gulls}\\] The gulls' ledge, \\d+ tokens[^\\n]*\\(as last turn\\) \\(you kept it whole last turn\\)`));
    expect(text3).not.toContain("### In last turn's prompt, not in this one");

    const list3 = await sceneList(b, third.id);
    const bell3 = lineOf(list3, bell);
    expect(bell3.line).toContain("; its text changed since last turn; let go by the Author when a prompt last held it: ");
    // The changed text is a file of its own; the text that stands is not written again.
    expect(bell3.file).not.toBe(bellFile1);
    const { scope: scope3 } = await placesOf(b, third.id);
    expect(await fileText(b, scope3, bell3.file)).toBe(BELL_CHANGED);
    expect(lineOf(list3, gulls).file).toBe(lineOf(list2, gulls).file);
    // An entry that left a turn ago stays on the scene's list, with nothing said of this turn.
    expect(lineOf(list3, oil).line).not.toContain("it left with this turn");
    expect(scope3.session).toBe(scope1.session);
  });

  test("with the setting off a turn starts with every entry whole, and a swipe is compared with the turn its attempts follow", async () => {
    const b = await bed({ answers: [lettingGo("The fog bell"), REPLY, replying("The ledge is white with them."), replying("They do not mind it.")] });
    keepersBook(b);
    await play(b, "normal", "I ask where the oil is kept, and who rings the bell.");
    const bell = idOf(b.model.requests[0], "The fog bell");

    const calls = b.model.requests.length;
    const second = await play(b, "normal", "I ask whether the gulls mind the bell, or the smell of the oil.");
    // The Author's choice does not stand: the bell is whole again, and the lore map says what it did with it.
    expect(b.requests[1]?.letGo).toBeUndefined();
    const text2 = sent(b.model.requests[calls]);
    expect(text2).toContain(BELL);
    expect(text2).toMatch(new RegExp(`\\[${bell}\\] The fog bell, \\d+ tokens[^\\n]*\\(as last turn\\) \\(you let it go last turn\\)`));
    expect(text2).not.toContain("starts this turn let go");

    // A swipe of the second reply follows the first turn, as the second did: the gulls are new to it too, and the bell as it was.
    const swiped = await play(b, "swipe");
    expect(swiped.id).not.toBe(second.id);
    const kept = sceneRead(b.turns.prompts.scene(USER, CHAT, swiped.id));
    expect(kept?.entries.map((e) => [e.title, e.here, e.status, e.lead])).toEqual([
      ["The oil store", true, "same", "kept"],
      ["The fog bell", true, "same", "let_go"],
      ["The gulls' ledge", true, "new", null],
    ]);
  });
});

describe("the comparison", () => {
  const held = (id: string, hash: string | null, more: Partial<HeldLore> = {}): HeldLore => ({ id, title: `Entry ${id}`, source: "Keeper's Book", how: "keyword", hash, chars: hash === null ? 0 : 120, file: hash === null ? null : `lore-${id}-${hash}.md`, ...more });
  const window = (seq: number, action: "let_go" | "note" | "restore" | "handoff", ids: string[], parent?: TraceRecord["parent"]): TraceRecord => ({
    seq,
    run: "run-1",
    scope: { user: USER, chat: CHAT, session: "s1", turn: "t1" },
    at: seq,
    agent: { id: parent === undefined ? "author-1" : "gm-1", definition: parent === undefined ? "author" : "gm" },
    ...(parent !== undefined ? { parent } : {}),
    event: { kind: "window", action, items: ids.map((id) => ({ id, tokens: 40 })), sparedTokens: 30, costTokens: 0 },
  });
  const started: TraceRecord = { seq: 1, run: "run-1", scope: { user: USER, chat: CHAT, session: "s1", turn: "t1" }, at: 1, agent: { id: "author-1", definition: "author" }, event: { kind: "run_started", run: "turn", turn: "new", lead: "author" } };

  test("what the lead did is its own last word on each entry: a note lets go, a restore brings back, a handoff keeps only what it names, and another agent's window is not its own", () => {
    const ids = ["e-1", "e-2", "e-3", "e-4"];
    // No record of a run: nothing is known.
    expect(leadChoices([], ids)).toBeNull();
    expect(leadChoices([started], ids)).toEqual(new Map([["e-1", "kept"], ["e-2", "kept"], ["e-3", "kept"], ["e-4", "kept"]]));
    const records = [
      started,
      window(2, "let_go", ["lore:e-1", "briefing:world", "lore:e-9"]),
      window(3, "note", ["lore:e-2"]),
      window(4, "restore", ["lore:e-1"]),
      // A sub-agent's own window is not the lead's.
      window(5, "let_go", ["lore:e-3"], { agent: "author-1", run: "run-1", call: "c1" }),
    ];
    expect(leadChoices(records, ids)).toEqual(new Map([["e-1", "kept"], ["e-2", "let_go"], ["e-3", "kept"], ["e-4", "kept"]]));
    // After a handoff only what it kept stands whole; a later restore brings another back.
    expect(leadChoices([...records, window(6, "handoff", ["lore:e-4", "call:c2"]), window(7, "restore", ["lore:e-3"])], ids)).toEqual(new Map([["e-1", "let_go"], ["e-2", "let_go"], ["e-3", "kept"], ["e-4", "kept"]]));
    // A run of the turn after the first (a continue) begins with a window of its own.
    expect(leadChoices([...records, { ...started, seq: 8, at: 8, run: "run-2" }], ids)?.get("e-2")).toBe("kept");
    // A Settle now run is given no prompt and holds none of the lore: what the run before it did stands through it.
    const settle = [{ ...started, seq: 8, at: 8, run: "run-settle", event: { ...started.event, turn: "continue" as const } }, { ...window(9, "restore", ["lore:e-2"]), run: "run-settle" }];
    expect(leadChoices([...records, ...settle], ids, new Set(["run-settle"]))?.get("e-2")).toBe("let_go");
    expect(leadChoices([...settle], ids, new Set(["run-settle"]))).toBeNull();
  });

  test("a turn with nothing before it says of no entry how it stands; the next says new, changed, as it was and gone, and carries what is known of each", () => {
    const first = sceneOf("s1", [held("e-1", "aa"), held("e-2", "bb"), held("e-3", null)], null);
    expect(first.entries.map((e) => [e.id, e.here, e.status, e.lead])).toEqual([["e-1", true, null, null], ["e-2", true, null, null], ["e-3", true, null, null]]);

    const did = new Map([["e-1", "let_go"], ["e-2", "kept"], ["e-3", "let_go"]] as const);
    const second = sceneOf("s1", [held("e-1", "aa"), held("e-3", "cc"), held("e-4", "dd")], { kept: first, did });
    expect(second.entries.map((e) => [e.id, e.here, e.status, e.lead])).toEqual([
      ["e-1", true, "same", "let_go"],
      // Its text was not found in the prompt before and is now: that is a change.
      ["e-3", true, "changed", "let_go"],
      ["e-4", true, "new", null],
      ["e-2", false, "gone", "kept"],
    ]);
    // Only an entry that stands as it was, and that the lead let go, starts the next turn let go.
    expect(standingLetGo(second)).toEqual(["lore:e-1"]);

    // The turn after: what left a turn ago stays on the scene's list with nothing said of this turn, and comes back as new, with what was known of it.
    const third = sceneOf("s1", [held("e-1", "aa")], { kept: second, did: null });
    expect(third.entries.map((e) => [e.id, e.here, e.status, e.lead])).toEqual([
      ["e-1", true, "same", "let_go"],
      ["e-3", false, "gone", "let_go"],
      ["e-4", false, "gone", null],
      ["e-2", false, null, "kept"],
    ]);
    const back = sceneOf("s1", [held("e-2", "bb")], { kept: third, did: new Map([["e-1", "kept"]]) });
    expect(back.entries.find((e) => e.id === "e-2")).toMatchObject({ here: true, status: "new", lead: "kept" });
    expect(back.entries.find((e) => e.id === "e-1")).toMatchObject({ here: false, status: "gone", lead: "kept" });

    // A new scene's list starts over: an entry of the scene before is none of this scene's list, though the map still says what left since the turn before.
    const next = sceneOf("s2", [held("e-1", "aa")], { kept: second, did });
    expect(next.entries.map((e) => [e.id, e.here, e.status])).toEqual([["e-1", true, "same"]]);
    expect(goneSince([held("e-1", "aa")], { kept: second, did }).map((e) => [e.id, e.status, e.lead])).toEqual([["e-3", "gone", "let_go"], ["e-4", "gone", null]]);
    // The next turn of the new scene carries nothing of the scene before.
    expect(sceneOf("s2", [held("e-1", "aa")], { kept: next, did: null }).entries.map((e) => e.id)).toEqual(["e-1"]);
    expect(sceneOf("s2", [held("e-1", "aa")], { kept: third, did: null }).entries.map((e) => e.id)).toEqual(["e-1"]);
  });

  test("a kept list reads back as it was written, and one this build cannot read is compared with nothing", () => {
    const scene: SceneKept = sceneOf("s1", [held("e-1", "aa"), held("e-2", null)], null);
    expect(sceneRead(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    for (const unreadable of [null, "text", [], { session: "s1" }, { session: "s1", entries: [{ id: 3 }] }, { session: "s1", entries: [{ id: "e-1", title: "T", status: "odd", lead: null }] }]) expect(sceneRead(unreadable)).toBeNull();
  });
});
