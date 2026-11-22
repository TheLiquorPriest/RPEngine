// Taking in a backlog (plan 3.2 §6.5): a character that holds more than one batch of perceptions it has not taken in (the setting
// `cast.takeInTokens`) is started `for: take-in` and given the batches by name, none of the perceptions; it hands each batch to an
// instance of itself with `task`, each instance is given its own batch and no other and writes that batch's memories, and the
// character settles its mind once, from what they report. No perception is taken in twice, and none is left. Where everything fits
// one batch the character is given the perceptions whole and takes them in itself. An agent that plays a character hands an instance
// only what is its character's own: the story record it names is not given. The Cast page's press starts one job for each character
// the cast holds, however its name is written, and none while its own agent is at work already, whose job has what waits in hand.
// Played through the stand-in Lumiverse on the scripted model. Every name is invented.

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
/** Five things that reached her in one turn, each a line long. */
const REACHED = ["The stranger climbed the stairs.", "The stranger asked whether the boat came.", "The lamp guttered twice.", "A bell rang out past the bar.", "The stranger left without his coat."];

function calling(call: string, args: JsonObject, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] };
}

/** The Author's turn: Wren cast a principal, on stage, and five perceptions of hers written with the reply. */
const VOICED: Answer[] = [
  calling("cast_update", { operations: [{ op: "cast", who: WREN, as: "principal", line: "The keeper of the light." }] }, "Wren answers; I voice her."),
  calling("story_record", { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: [WREN] }] }),
  { pieces: [{ text: '<reply>Wren looks past you at the sea. "The boat is late."</reply>' }, { call: "perceive", args: { perceptions: REACHED.map((content) => ({ who: WREN, reach: "whole", content })) } }] },
  { pieces: [{ text: "Nothing more." }] },
];

/** Each call answered by whose it is: a character's agent holds `remember`, the Author does not. */
function routed(author: Answer[], hers: Answer, calls: number): Answer[] {
  const route: Answer = (request) => {
    if (request.tools.some((t) => t.name === "remember")) return typeof hers === "function" ? hers(request) : hers;
    const next = author.shift();
    if (next === undefined) throw new Error("the Author's script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  return Array.from({ length: calls }, () => route);
}

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

/** Wren's record at the chat's newest turn: her memories' gists, her beliefs, and the perceptions she holds and has not taken in. */
function wrenNow(b: TurnBed): { memories: unknown[]; from: string[]; beliefs: unknown[]; untaken: string[]; given: string[] } {
  const u = b.turns.store.user(USER);
  const record = CastRecord.read(b.turns.store, USER, castAt(u, CHAT, null));
  const wren = findCharacter(b.turns.store.db, USER, chatLine(u, CHAT), WREN)!;
  const memories = record.of(wren.id, "memory");
  return {
    memories: memories.map((m) => m.fields.gist),
    from: memories.flatMap((m) => (Array.isArray(m.fields.from) ? (m.fields.from as string[]) : [])),
    beliefs: record.of(wren.id, "mind").filter((m) => m.fields.kind === "belief").map((m) => m.fields.text),
    untaken: untakenPerceptions(record, wren.id).map((p) => p.id),
    given: record.of(wren.id, "perception").map((p) => p.id),
  };
}

/** The text of everything a request carries. */
const sent = (request: { messages: readonly unknown[] }): string => JSON.stringify(request.messages);
/** The ids of the perceptions a request holds in full. */
const held = (text: string): string[] => [...text.matchAll(/\[(p-[\w-]+)\]/g)].map((m) => m[1] as string);
/** The batches a plan lists, by the name that opens each: a range from one id to another (the instructions' own example names none). */
const listed = (text: string): string[] => [...text.matchAll(/cast:self\((unprocessed-perceptions\[p-[\w-]+\.\.p-[\w-]+\])\)/g)].map((m) => m[1] as string);

async function jobDone(b: TurnBed): Promise<void> {
  await b.until("the job to end", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.ended !== undefined && j.state === "done"));
}

test("a backlog larger than one batch: her agent is given the batches by name and none of the perceptions, hands each to an instance of itself, each instance takes in its own batch and no other, and she settles her mind once", async () => {
  const requests: { kind: "lead" | "piece" | "settle"; text: string }[] = [];
  let settled = 0;
  const hers: Answer = (request) => {
    const text = sent(request);
    const answered = request.messages.some((m) => m.role === "toolResult");
    // An instance starts from the brief that names its batch; the character's own later requests hold those briefs too, as its call's arguments.
    const batch = /BATCH (unprocessed-perceptions\[[^\]]+\])/.exec(JSON.stringify(request.messages[1] ?? ""))?.[1];
    if (batch !== undefined) {
      // An instance: it writes one memory from the perceptions of its batch, then reports the memory by its id and gist.
      if (answered) return { pieces: [{ text: `Wrote ${/\bmem-\d+\b/.exec(text)?.[0] ?? "no memory"}: what reached me in ${batch}.` }] };
      requests.push({ kind: "piece", text });
      const ids = held(text);
      return { pieces: [{ call: "remember", args: { memories: [{ text: `What reached me in ${batch}.`, gist: `Gist of ${ids.join("+")}`, weight: 2, from: ids, source: "character" }] } }] };
    }
    if (!answered) {
      // The character itself, started for the purpose: a piece for each batch the plan lists, all in one call.
      requests.push({ kind: "lead", text });
      // It also names the story's brief, the Author's own view of the story, which is not a character's to hand on.
      return { pieces: [{ call: "task", args: { pieces: listed(text).map((view) => ({ brief: `BATCH ${view} Take in this batch.`, for: "batch", attach: [`cast:self(${view})`, "story:brief"] })) } }] };
    }
    if (settled === 0) {
      settled += 1;
      requests.push({ kind: "settle", text });
      // She settles from what the instances report: a memory one of them wrote, named by its id.
      return { pieces: [{ call: "mind_set", args: { entries: [{ kind: "belief", text: "The stranger will come back for his coat.", from: [/\bmem-\d+\b/.exec(text)?.[0] ?? "none"], source: "character" }] } }] };
    }
    return { pieces: [{ text: "Taken in." }] };
  };
  const b = await openTurnBed({
    off: ["rules/unsourced", "rules/perceptions-owed", "rules/memory-owed", "rules/memory-late", "rules/memory-scene-end"],
    // A batch holds two of her perceptions at most.
    global: "cast:\n  takeInTokens: 24\n",
    answers: routed([...VOICED], hers, 40),
  });
  beds.push(b);
  await play(b, "I ask whether the boat came.");
  const before = wrenNow(b);
  expect(before.untaken).toHaveLength(REACHED.length);

  // The Cast page says how large what waits is, and in how many batches her agent takes it in.
  const list = await b.page<{ characters: { name: string; waits: { perceptions: number; tokens?: number; batches?: number } }[] }>("GET", `/api/v1/chats/${CHAT}/cast`);
  const waits = list.body.characters.find((c) => c.name === WREN)?.waits;
  expect(waits?.perceptions).toBe(REACHED.length);
  expect(waits?.batches).toBeGreaterThan(1);

  const started = await b.page<{ jobs: unknown[]; refused: unknown[] }>("POST", `/api/v1/chats/${CHAT}/jobs/take-in`, { characters: [WREN] });
  expect(started.body).toMatchObject({ refused: [] });
  expect(started.body.jobs).toHaveLength(1);
  await jobDone(b);

  // She was given the plan: every batch by its name with its size, and not one perception in full.
  const lead = requests.find((r) => r.kind === "lead")!;
  const batches = listed(lead.text);
  expect(batches).toHaveLength(waits?.batches as number);
  expect(lead.text).toContain(`${REACHED.length} perceptions, about`);
  expect(held(lead.text)).toEqual([]);
  for (const content of REACHED) expect(lead.text).not.toContain(content);

  // Each instance was given its own batch whole and nothing of another's, and between them every perception once.
  const pieces = requests.filter((r) => r.kind === "piece");
  expect(pieces).toHaveLength(batches.length);
  const given = pieces.map((p) => held(p.text));
  expect(given.flat().sort()).toEqual([...before.untaken].sort());
  expect(new Set(given.flat()).size).toBe(given.flat().length);
  // What an instance is handed is its character's own: the batch its start named is given under its name, the story's brief is not, and she is told so.
  for (const piece of pieces) {
    expect(piece.text).toContain("### cast:self(unprocessed-perceptions[");
    expect(piece.text).not.toContain("### story:brief");
  }
  expect(requests.find((r) => r.kind === "settle")?.text).toContain("was not given story:brief");

  // Every perception is taken in, each named by one memory and no more; and her mind was settled once, by her.
  const after = wrenNow(b);
  expect(after.untaken).toEqual([]);
  expect(after.memories).toHaveLength(batches.length);
  expect([...after.from].sort()).toEqual([...before.untaken].sort());
  expect(after.beliefs).toEqual(["The stranger will come back for his coat."]);
  expect(requests.filter((r) => r.kind === "settle")).toHaveLength(1);
});

test("what fits one batch is given whole, and she takes it in herself", async () => {
  const seen: string[] = [];
  const hers: Answer = (request) => {
    const text = sent(request);
    if (request.messages.some((m) => m.role === "toolResult")) return { pieces: [{ text: "Taken in." }] };
    seen.push(text);
    return { pieces: [{ call: "remember", args: { memories: [{ text: "A stranger came and went in the storm.", gist: "A stranger came and went.", weight: 2, from: held(text), source: "character" }] } }] };
  };
  const b = await openTurnBed({ off: ["rules/unsourced", "rules/perceptions-owed", "rules/memory-owed", "rules/memory-late", "rules/memory-scene-end"], answers: routed([...VOICED], hers, 20) });
  beds.push(b);
  await play(b, "I ask whether the boat came.");
  await b.page("POST", `/api/v1/chats/${CHAT}/jobs/take-in`, { characters: [WREN] });
  await jobDone(b);

  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain(`${REACHED.length} perceptions, about`);
  expect(seen[0]).toContain("in full below");
  for (const content of REACHED) expect(seen[0]).toContain(content);
  expect(listed(seen[0] as string)).toEqual([]);
  expect(wrenNow(b)).toMatchObject({ untaken: [], memories: ["A stranger came and went."] });
});

/** What the take-in press answers: the jobs it started, and the characters it started none for, with why. */
type Pressed = { jobs: { character: string; job: { id: string } }[]; refused: { character: string; why: string }[] };

test("the press starts one job for each character the cast holds, however its name is written; a name it does not hold, and a character whose own agent is at work already, are answered with why; the Cast page counts none of what that job has in hand", async () => {
  const release = Promise.withResolvers<void>();
  let starts = 0;
  const hers: Answer = async (request) => {
    const text = sent(request);
    if (request.messages.some((m) => m.role === "toolResult")) return { pieces: [{ text: "Taken in." }] };
    // Her agent holds its first call until the test lets it go: the job is at work all the while.
    starts += 1;
    await release.promise;
    return { pieces: [{ call: "remember", args: { memories: [{ text: "A stranger came and went in the storm.", gist: "A stranger came and went.", weight: 2, from: held(text), source: "character" }] } }] };
  };
  const b = await openTurnBed({ off: ["rules/unsourced", "rules/perceptions-owed", "rules/memory-owed", "rules/memory-late", "rules/memory-scene-end"], answers: routed([...VOICED], hers, 20) });
  beds.push(b);
  await play(b, "I ask whether the boat came.");
  const waits = async (): Promise<number | undefined> => (await b.page<{ characters: { name: string; waits: { perceptions: number } }[] }>("GET", `/api/v1/chats/${CHAT}/cast`)).body.characters.find((c) => c.name === WREN)?.waits.perceptions;
  const press = async (characters: string[]): Promise<Pressed> => (await b.page<Pressed>("POST", `/api/v1/chats/${CHAT}/jobs/take-in`, { characters })).body;
  expect(await waits()).toBe(REACHED.length);

  // A name the cast does not hold starts nothing, and is answered so in the cast's words.
  expect(await press(["Nobody Here"])).toEqual({ jobs: [], refused: [{ character: "Nobody Here", why: "There is no Nobody Here in the cast." }] });
  // Two ways of writing her name are one character: one job, under the name the cast holds.
  const first = await press([WREN, WREN.toLowerCase()]);
  expect(first.refused).toEqual([]);
  expect(first.jobs.map((j) => j.character)).toEqual([WREN]);
  const job = first.jobs[0]?.job.id ?? "";

  // While her agent is at work, what its job was given is in its hands: the Cast page counts none of it, and a second press starts no second job, naming the one at work.
  expect(await waits()).toBe(0);
  expect(await press([WREN])).toEqual({ jobs: [], refused: [{ character: WREN, why: `${WREN}'s own agent is at work already in job ${job}, which has what waits for it in hand, so no second job was started.` }] });
  expect((await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.map((j) => j.id)).toEqual([job]);

  // Let go, it takes in every perception once, in one memory.
  release.resolve();
  await jobDone(b);
  expect(starts).toBe(1);
  expect(wrenNow(b)).toMatchObject({ untaken: [], memories: ["A stranger came and went."] });
  expect(await waits()).toBe(0);
});
