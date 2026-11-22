// A write's receipt (plan §5.2). With a keeper (the user's `tools.receiptTokens` at a number) a tool that writes answers with what it
// wrote and under which ids, what the engine made of it, and every report line whole, and says nothing its caller sent; the whole answer
// is in the file of the turn the receipt's last line names, which an agent reads as it reads any file. A receipt past its size leaves ids
// to that file and says how many. A failed answer is never made a receipt. With no keeper (the setting at none) every answer is the
// tool's whole answer. The files here are RPE's own tree over a test's folder. Every name and word here is made up.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import type { AreaCtx } from "../../src/iface/kit";
import { type ReceiptKeeper, receiptKeeper } from "../../src/iface/receipt";
import { type GuidanceFiles, shippedTexts } from "../../src/iface/texts";
import { type LaidTree, layTree } from "../tree/fixtures";
import { CHAT, dataOf, type Rig, rig, texts, USER, wordsFromFiles } from "./rig";

/** Where the whole of an answer goes: the `cache/answers/` of the seed's turn, as the tree lays a turn's folder. */
const KEPT = `sessions/${KIT_SEED.scope.session}/turns/turn-1-kitturn1/cache/answers/`;

/** Texts the call sends: a receipt says none of them again. */
const MOOD = "wary of every stranger since the forged seal came through his door";
const BOOTS = "caked with river mud to the knee, one lace snapped and knotted twice";
const CIDER = "a mug of cider";

const SRC = { from: "prose", message: "m-8" };

/** One call of several operations: a value set, a fact with no lane named (a report), a thing made where the rules would not have it (a report), and a payment. */
const CALL: JsonObject = {
  operations: [
    { op: "set", at: "bram", key: "mood", value: MOOD, source: SRC },
    { op: "fact", about: "wren", key: "boots", value: BOOTS, source: SRC },
    { op: "spawn", name: "Brass key", in: "bell", source: SRC },
    { op: "pay", who: "wren", to: "bram", amount: 3, for: CIDER, source: SRC },
  ],
};

const REPORTS = [
  "Operation 2 (fact): no lane was named, so this fact is recorded in the engine lane.",
  "Operation 3 (spawn): Brass key was put with Market bell [bell] although the world's rules for things say otherwise (cant_hold).",
];

let place: string;
let tree: LaidTree;
const warned: string[] = [];

beforeAll(async () => {
  place = await mkdtemp(join(tmpdir(), "rpe-receipt-"));
  tree = await layTree(KIT_SEED, place);
});

afterAll(async () => {
  await tree.close();
  await rm(place, { recursive: true, force: true });
});

/** A keeper over the tree's own file port, a receipt held to `chars`. */
function keeper(chars: number): ReceiptKeeper {
  return receiptKeeper(tree.port, chars, { warn: (message) => void warned.push(message) });
}

/** A call as the turn lane makes it: worked at the store rig's chat and turn, its own files kept in the folders of the tree's chat. */
function call(t: Rig, name: string, args: JsonObject, callId: string): Promise<ToolResult> {
  const tool = t.tools.get(name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  const ctx: AreaCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn: t.turn.id }, agent: { id: "author-1", definition: "author" }, run: "run-1", callId, signal: new AbortController().signal, onUpdate: () => undefined, folders: KIT_SEED.scope };
  return tool.run(args, ctx);
}

/** A kept answer as an agent's `file_read` reads it: through the file port, at the agent's own scope; null when no such file is there. */
async function fileRead(callId: string): Promise<string | null> {
  const read = await tree.port.read(KIT_SEED.scope, `${KEPT}${callId}.md`);
  return read.status === "read" ? read.text : null;
}

/** An answer as it is kept whole: its parts, then its reports, a line each. */
const wholeText = (r: ToolResult): string => [...texts(r), ...(r.reports ?? [])].join("\n");

/** The ids two tables draw apart (a turn's, a fact's, a made thing's), made one: two calls of the same operations then answer the same. A turn's id first, since its own letters may read as a fact's id. */
const sameIds = (text: string): string => text.replace(/"turn":"[0-9a-f-]{36}"/g, '"turn":"0"').replace(/"f-[0-9a-f]{12}"/g, '"f-0"').replace(/thing_brass_key_[0-9a-f]+/g, "thing_brass_key_0");

describe("a receipt", () => {
  test("says what was written and under which ids, with every report line and nothing the call sent, and names the file that holds the whole answer", async () => {
    const whole = await call(await rig(), "world_apply", CALL, "call-whole");
    const receipt = await call(await rig({ receipts: keeper(6000) }), "world_apply", CALL, "call-1");
    expect(receipt.error).toBeUndefined();
    wordsFromFiles(receipt);

    // Each operation by its number, its op and the ids it wrote under, with what the engine made: the fact's id, the thing's.
    const data = dataOf(receipt);
    expect(Object.keys(data)).toEqual(["operations", "changed"]);
    const [set, fact, spawn, pay] = data.operations as JsonObject[];
    expect(set).toEqual({ n: 1, op: "set", applied: true, changes: [1] });
    expect(fact).toEqual({ n: 2, op: "fact", applied: true, fact: expect.stringMatching(/^f-[0-9a-f]{12}$/), changes: [2] });
    expect(spawn).toEqual({ n: 3, op: "spawn", applied: true, made: expect.stringMatching(/^thing_brass_key_/), changes: [3] });
    expect(pay).toEqual({ n: 4, op: "pay", applied: true, changes: [4, 5, 6, 7] });
    // Every thing that changed, with what the engine made of the call: the balance it worked out, the thing it made, by its id. A value that is the call's own words is named by its key, and not said again.
    const changed = data.changed as JsonObject[];
    expect(changed).toContainEqual({ at: "entity:acct_wren", name: "Wren's coin", was: { balance: null }, now: { balance: "$9.00" } });
    expect(changed.find((c) => c.at === `entity:${String(spawn?.made)}`)).toMatchObject({ name: "Brass key", new: true, now: { in: "Market bell" }, as_sent: ["name"] });
    expect(changed).toContainEqual({ at: "entity:bram", name: "Bram", as_sent: ["mood"] });

    // Every report line, whole; and nothing the call sent, said again.
    expect(receipt.reports).toEqual(REPORTS);
    expect(whole.reports).toEqual(REPORTS);
    const said = wholeText(receipt);
    for (const sent of [MOOD, BOOTS, CIDER, SRC.message]) expect(said).not.toContain(sent);

    // Its last line names the file, which holds the whole answer as the tool gave it, and reads as any file of the turn does.
    const file = await fileRead("call-1");
    expect(texts(receipt).at(-1)).toBe(`This is world_apply's receipt. Its whole answer, ${file?.length} characters, is in ${KEPT}call-1.md.`);
    expect(sameIds(file ?? "")).toBe(sameIds(wholeText(whole)));
    for (const sent of [MOOD, BOOTS]) expect(file).toContain(sent);
    expect(said.length).toBeLessThan((file?.length ?? 0) / 3);

    // What the Turn page shows of the call keeps its shape, and gains where the whole is.
    expect(receipt.details).toEqual({ changes: [1, 2, 3, 4, 5, 6, 7], parts: ["data", "line"], receipt: { path: `${KEPT}call-1.md`, chars: file?.length ?? 0 } });
    expect(warned).toEqual([]);
  });

  test("past its size keeps its report lines whole, and says how many ids it left to the file", async () => {
    // Room for the two reports and the first two operations: the other two, and the three things that changed, are the file's.
    const receipt = await call(await rig({ receipts: keeper(360) }), "world_apply", CALL, "call-2");
    wordsFromFiles(receipt);
    expect(receipt.reports).toEqual(REPORTS);
    expect(dataOf(receipt)).toEqual({ operations: [{ n: 1, op: "set", applied: true, changes: [1] }, { n: 2, op: "fact", applied: true, fact: expect.stringMatching(/^f-/), changes: [2] }] });
    expect(texts(receipt).slice(1)).toEqual([
      "5 of the 7 ids world_apply wrote under are left out of this receipt, to hold it to its size; the file lists them all.",
      expect.stringContaining(`is in ${KEPT}call-2.md`),
    ]);
    expect(receipt.details).toMatchObject({ parts: ["data", "line", "line"], receipt: { path: `${KEPT}call-2.md`, left: 5 } });
    expect((JSON.parse((await fileRead("call-2"))?.split("\n")[0] ?? "{}") as JsonObject).operations).toHaveLength(4);

    // A size the reports alone pass: no id is listed, and no report is cut.
    const least = await call(await rig({ receipts: keeper(0) }), "world_apply", CALL, "call-3");
    expect(least.reports).toEqual(REPORTS);
    expect(texts(least)).toEqual(["7 of the 7 ids world_apply wrote under are left out of this receipt, to hold it to its size; the file lists them all.", expect.stringContaining(`is in ${KEPT}call-3.md`)]);
  });

  test("is never made of a failed answer: its lines tell the caller how to mend the call", async () => {
    const lost: JsonObject = { operations: [{ op: "move", who: "someone who is not here", to: "cellar", source: SRC }] };
    const plain = await call(await rig(), "world_apply", lost, "call-plain");
    const failed = await call(await rig({ receipts: keeper(0) }), "world_apply", lost, "call-4");
    expect(failed.error).toBe(true);
    expect(failed).toEqual(plain);
    expect(texts(failed).at(-1)).toBe("Nothing was recorded. Send the call again with that put right.");
    expect(await fileRead("call-4")).toBeNull();
  });

  test("is not made with the setting at none: the answer is whole, what was sent given back and how each thing now stands", async () => {
    const whole = await call(await rig(), "world_apply", CALL, "call-5");
    const data = dataOf(whole);
    expect(Object.keys(data)).toEqual(["operations", "changed", "now"]);
    expect((data.operations as JsonObject[])[0]).toEqual({ n: 1, op: "set", lane: "engine", applied: true, source: SRC, changes: [1] });
    expect((data.now as JsonObject[]).length).toBeGreaterThan(0);
    expect(wholeText(whole)).toContain(MOOD);
    expect(texts(whole)).toHaveLength(1);
    expect(whole.details).toEqual({ changes: [1, 2, 3, 4, 5, 6, 7], parts: ["data"] });
    expect(await fileRead("call-5")).toBeNull();
  });

  test("is the answer itself for a tool that says nothing its caller sent, while it fits; past the size its data is the file's", async () => {
    const roll: JsonObject = { who: "wren", for: "whether she slips past the gate guard unseen", dice: "1d20" };
    const fits = await call(await rig({ receipts: keeper(6000) }), "roll", roll, "call-6");
    expect(dataOf(fits).roll).toMatchObject({ who: "Wren [wren]" });
    expect(fits.details).toEqual({ parts: ["data"] });
    expect(await fileRead("call-6")).toBeNull();
    const past = await call(await rig({ receipts: keeper(20) }), "roll", roll, "call-7");
    expect(texts(past)).toEqual([expect.stringContaining(`This is roll's receipt. Its whole answer,`)]);
    expect((JSON.parse((await fileRead("call-7")) ?? "{}") as JsonObject).roll).toMatchObject({ who: "Wren [wren]" });
  });

  test("gives the answer whole where no line in force names the file, and where the file could not be kept", async () => {
    // His own answers part, without the line: nothing is left out for a file no line would name.
    const files: GuidanceFiles = { read: async (kind, name) => (await shippedTexts().read(kind, name))?.replace(/^receipt_kept:.*\n/m, "") };
    const unnamed = await call(await rig({ receipts: keeper(0), files }), "world_apply", CALL, "call-8");
    expect(Object.keys(dataOf(unnamed))).toEqual(["operations", "changed", "now"]);
    expect(await fileRead("call-8")).toBeNull();
    // A call whose own scope the tree holds no chat for: its whole cannot be kept, so the answer is whole, and the log says so.
    const t = await rig({ receipts: keeper(0) });
    const unkept = await t.call("world_apply", CALL);
    expect(Object.keys(dataOf(unkept))).toEqual(["operations", "changed", "now"]);
    expect(unkept.reports).toEqual(REPORTS);
    expect(warned).toEqual(["The whole of a tool's answer could not be kept in the turn's folder; the answer was given whole, with no receipt."]);
  });

  test("is kept in a folder of the turn's cache that an agent may write in and reads from; for a run with no turn, in the session's", async () => {
    // The turn's `cache/` is one of the folders an agent of the turn may write in, and its `answers/` is RPE's own: RPH's `results/` holds what RPH clipped.
    const warnings = warned.length;
    const { writable } = await tree.port.places(KIT_SEED.scope);
    expect(writable.filter((folder) => KEPT.startsWith(folder))).toEqual([KEPT.replace("answers/", "")]);
    // A run with no turn (a job of the chat): the session's own cache, read at the same scope.
    const noTurn = { user: KIT_SEED.scope.user, chat: KIT_SEED.scope.chat, session: KIT_SEED.scope.session };
    const path = await keeper(0).keep(noTurn, "call-9", "the whole answer");
    expect(path).toBe(`sessions/${KIT_SEED.scope.session}/cache/answers/call-9.md`);
    const read = await tree.port.read(noTurn, path ?? "");
    expect(read.status === "read" ? read.text : read.status).toBe("the whole answer");
    // A call's id is the file's name: what a name may not hold is made what it may.
    expect(await keeper(0).keep(KIT_SEED.scope, "call/../9:a", "x")).toBe(`${KEPT}call_.._9_a.md`);
    expect(warned).toHaveLength(warnings);
  });
});
