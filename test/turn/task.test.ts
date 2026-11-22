// `task` on RPE's side (plan 3.2 §7.3): the shipped definitions hold it; a character's own agent starts instances of itself and no
// other definition; an instance it starts plays the character it plays, is given what that character's agent is given, and writes
// as that character. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import { CastRecord, chatLine, findCharacter } from "../../src/cast";
import { untakenPerceptions } from "../../src/cast/memory";
import { castAt } from "../../src/cast/path";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const WREN = "Wren Hale";
const WHOLE = "BRIEF-WHOLE Take in what you perceived this turn.";
const PIECE = "BRIEF-PIECE Take in the stranger on the stairs.";

/** One answer that makes one tool call, after the intent record when one is given. */
function calling(call: string, args: JsonObject, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] };
}

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

test("the shipped definitions that work in a turn hold task, and each but the Author and the assistant starts only itself", async () => {
  const b = await openTurnBed({ answers: [] });
  beds.push(b);
  const listed = await b.turns.harness.definitions.list({ user: USER, chat: CHAT, session: "s-task" });
  const of = (name: string) => listed.find((d) => d.name === name);
  for (const name of ["author", "assistant", "gm", "character", "keeper", "historian", "indexer"]) expect({ name, holds: of(name)?.tools.includes("task") }).toEqual({ name, holds: true });
  expect(["gm", "character", "keeper", "historian", "indexer"].map((name) => of(name)?.starts)).toEqual([["gm"], ["character"], ["keeper"], ["historian"], ["indexer"]]);
  expect([of("author")?.starts, of("assistant")?.starts]).toEqual([undefined, undefined]);
});

test("a character's own agent hands a piece of its work to an instance of itself: the instance plays the same character, is given what she perceived, and what it writes is hers", async () => {
  // The Author's own calls, in order: it casts Wren, opens the scene, replies and writes what she perceived, then has her agent take it in.
  const author: Answer[] = [
    calling("cast_update", { operations: [{ op: "cast", who: WREN, as: "principal", line: "The keeper of the light." }] }, "Wren answers; I voice her."),
    calling("story_record", { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: [WREN] }] }),
    { pieces: [{ text: '<reply>Wren looks past you at the sea. "The boat is late."</reply>' }, { call: "perceive", args: { perceptions: [{ who: WREN, reach: "whole", content: "A stranger climbed the stairs and asked whether the boat came.", knows: ["A stranger is asking after the boat."] }] } }] },
    calling("delegate", { agent: "character", plays: WREN, brief: WHOLE }),
    { pieces: [{ text: "Done." }] },
  ];
  // Her agent splits the work: one piece, an instance of its own definition. It names no one to play: the instance plays whom it plays.
  const hers: Answer[] = [calling("task", { pieces: [{ brief: PIECE, name: "stairs" }] }), { pieces: [{ text: "Taken in." }] }];
  // The instance reads the id of what she perceived from what it was given, and writes a memory from it.
  const instance: Answer[] = [
    (request) => {
      const id = /\[(p-\d+)\]/.exec(JSON.stringify(request.messages))?.[1] ?? "none";
      const memories: JsonObject = { memories: [{ text: "A stranger came up the stairs in the storm and asked about the boat.", gist: "A stranger asked after the boat.", weight: 2, who: ["the stranger"], about: ["the boat"], from: [id], source: "character" }] };
      return { pieces: [{ call: "remember", args: memories }] };
    },
    { pieces: [{ text: "The stairs are taken in." }] },
  ];
  // Each call is answered from its own agent's list: the instance's requests hold its piece's brief, her agent's hold the whole brief, and the rest are the Author's.
  const route: Answer = (request) => {
    const sent = JSON.stringify(request.messages);
    const list = sent.includes("BRIEF-PIECE") && request.tools.some((t) => t.name === "remember") && !sent.includes("BRIEF-WHOLE") ? instance : sent.includes("BRIEF-WHOLE") && request.tools.some((t) => t.name === "remember") ? hers : author;
    const next = list.shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  const b = await openTurnBed({ off: ["rules/unsourced"], answers: Array.from({ length: author.length + hers.length + instance.length }, () => route) });
  beds.push(b);
  const turn = await play(b, "I ask whether the boat came.");
  expect([author.length, hers.length, instance.length]).toEqual([0, 0, 0]);

  // The instance's first request: its piece's brief, the frame saying whom it is, and what she perceived, given by the character's definition.
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  const first = sent.find((s) => s.includes("BRIEF-PIECE") && !s.includes("BRIEF-WHOLE"));
  expect(first).toBeDefined();
  expect(first).toContain(`You are ${WREN}.`);
  expect(first).toContain("A stranger climbed the stairs and asked whether the boat came.");

  // What the instance wrote is Wren's own memory, and the perception it names is taken in.
  const u = b.turns.store.user(USER);
  const record = CastRecord.read(b.turns.store, USER, castAt(u, CHAT, turn));
  const wren = findCharacter(b.turns.store.db, USER, chatLine(u, CHAT), WREN)!;
  expect(record.of(wren.id, "memory").map((m) => m.fields.gist)).toEqual(["A stranger asked after the boat."]);
  expect(untakenPerceptions(record, wren.id)).toEqual([]);
  // Her agent read the instance's answer as a receipt, by the name it gave the piece.
  const answered = sent.find((s) => s.includes("BRIEF-WHOLE") && s.includes("The stairs are taken in."));
  expect(answered).toBeDefined();
});

test("a character's own agent cannot start another definition: the piece is answered as not started, and the call says whom it may start", async () => {
  const author: Answer[] = [
    calling("cast_update", { operations: [{ op: "cast", who: WREN, as: "principal", line: "The keeper of the light." }] }, "Wren answers."),
    calling("delegate", { agent: "character", plays: WREN, brief: WHOLE }),
    { pieces: [{ text: "<reply>Wren shrugs.</reply>" }] },
  ];
  const hers: Answer[] = [calling("task", { agent: "gm", pieces: [{ brief: PIECE }] }), { pieces: [{ text: "I asked nobody." }] }];
  const route: Answer = (request) => {
    const next = (request.tools.some((t) => t.name === "remember") ? hers : author).shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  const b = await openTurnBed({ off: ["rules/unsourced", "rules/perceptions-owed"], answers: Array.from({ length: author.length + hers.length }, () => route) });
  beds.push(b);
  await play(b, "I ask whether the boat came.");
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent.some((s) => s.includes("gm was not started: you may start character."))).toBe(true);
  // No GM ran: no request holds the GM's own opening.
  expect(sent.some((s) => s.includes("You are the GM, at this table"))).toBe(false);
});
