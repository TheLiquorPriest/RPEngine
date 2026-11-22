// An indexing job over a list (plan 3.2 §7.5): its agent is given the chat's unindexed lore once, as a plan of numbered batches
// kept with the job (`index:plan`), and hands each batch to an instance of itself with `task`, each attaching its batch by number
// (`index:batch(n)`); each instance's first request holds its own batch and none of the others', nothing is indexed twice, and a
// number the plan does not have is answered with the numbers it has. The pieces share a notes file in the job's session folder,
// since a job has no turn. Played through the stand-in Lumiverse on the scripted model, on a chat that plays an invented world. Every
// name and text is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { Answer, RecordedRequest } from "rp-harness/testing/rig";
import { NO_SESSION } from "../../src/turn";
import { world } from "../iface/rig";
import { CHAT, openTurnBed, playsWorld, type TurnBed, USER } from "./bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

const BOOK = { id: "wb-harbor", name: "Harbor Ledger" };
const ENTRIES = [
  { id: "wbe-net", title: "The net loft", keys: ["net"], content: "Nets are mended in the loft above the fish market." },
  { id: "wbe-tide", title: "The tide table", keys: ["tide"], content: "High water comes twice a day, an hour later each day." },
  { id: "wbe-rope", title: "The rope guild", keys: ["rope"], content: "The rope guild meets on the first night of every month." },
  { id: "wbe-beacon", title: "The beacon", keys: ["beacon"], content: "The beacon on the point is lit at dusk by the youngest keeper." },
  { id: "wbe-toll", title: "The bridge toll", keys: ["toll"], content: "Crossing the stone bridge costs a copper each way." },
  { id: "wbe-well", title: "The square's well", keys: ["well"], content: "The well in the square runs brackish after a storm." },
];

/** Every text a request holds, its messages' in order. */
function textsOf(r: Pick<RecordedRequest, "messages"> | undefined): string {
  return (r?.messages ?? []).flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])))).join("\n");
}

/** The entries a text shows as a batch does, `### [e-1] The net loft (from Harbor Ledger; revision 1; …)`, with the revision each was shown at. */
function shownIn(text: string): { id: string; revision: string; title: string }[] {
  return [...text.matchAll(/### \[(e-\d+)\] (.+?) \(from [^;]+; revision (\d+)/g)].map((m) => ({ id: m[1] ?? "", title: m[2] ?? "", revision: m[3] ?? "" }));
}

/** One answer that makes one tool call. */
const calling = (call: string, args: JsonObject): Answer => ({ pieces: [{ call, args }] });

test("an indexing job is given its plan, hands each numbered batch to an instance of its own, and nothing is indexed twice", async () => {
  // The job's agent: it starts a piece for each of the plan's three batches, and one for a number the plan does not have.
  const lead: Answer[] = [
    calling("task", {
      together: true,
      pieces: [1, 2, 3, 9].map((n) => ({ brief: `BATCH-${n} Index batch ${n} of the plan.`, for: "batch", attach: [`index:batch(${n})`], name: `batch-${n}` })),
    }),
    { pieces: [{ text: "The three batches are indexed." }] },
  ];
  // Each piece writes the lines of every entry its batch shows, with the revision it shows, then answers.
  const written: string[] = [];
  const piece = (n: number): Answer[] =>
    n === 9
      ? [{ pieces: [{ text: "There was nothing to index." }] }]
      : [
          (request) => {
            const entries = shownIn(textsOf(request)).map((e) => ({ id: e.id, revision: e.revision, kind: "place", line: `${e.title}: as the entry says.` }));
            written.push(...entries.map((e) => e.id));
            return { pieces: [{ call: "lore_index_write", args: { entries } }] };
          },
          { pieces: [{ text: `Batch ${n} indexed.` }] },
        ];
  const pieces = new Map([1, 2, 3, 9].map((n) => [n, piece(n)]));
  // A request is the job's agent's while it holds the plan; else it is the piece its brief names.
  const route: Answer = (request) => {
    const text = textsOf(request);
    const n = /BATCH-(\d+)/.exec(text)?.[1];
    const list = text.includes("This job's plan:") || n === undefined ? lead : pieces.get(Number(n));
    const next = list?.shift();
    if (next === undefined) throw new Error(`the script has no answer left for this call (${n === undefined ? "the job's agent" : `piece ${n}`})`);
    return typeof next === "function" ? next(request) : next;
  };
  const b = (bed = await openTurnBed({ off: ["rules/unsourced"], global: ["lore:", "  index:", "    entriesPerCall: 2", ""].join("\n"), answers: Array.from({ length: 9 }, () => route) }));
  await playsWorld(b, world());
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", BOOK.id, BOOK.name, USER);
  for (const [i, e] of ENTRIES.entries()) {
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", e.id, BOOK.id, String(i + 1), JSON.stringify(e.keys), e.content, e.title);
  }
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: [BOOK.id] }), CHAT);

  const started = await b.turns.harness.jobs.start({ user: USER, chat: CHAT, session: NO_SESSION }, { agent: "indexer", brief: "Index this chat's lore." });
  if ("refused" in started) throw new Error(`The job was refused: ${JSON.stringify(started)}`);
  const ended = await b.until("the indexing job to end", async () => {
    const view = await b.turns.harness.jobs.get(USER, started.id);
    return view !== undefined && !["queued", "held", "running", "asking"].includes(view.state) ? view : null;
  });
  expect(ended.state).toBe("done");
  expect([lead.length, ...[...pieces.values()].map((list) => list.length)]).toEqual([0, 0, 0, 0, 0]);

  // The job's agent is given the plan: three numbered batches of two entries, each with its size.
  const requests = b.model.requests.map(textsOf);
  const first = requests.find((text) => text.includes("This job's plan:")) ?? "";
  expect(first).toContain("This job's plan: the entries not indexed when it started, in 3 numbered batches, 3 of them with entries still to index.");
  for (const n of [1, 2, 3]) expect(first).toMatch(new RegExp(`- Batch ${n}: 2 of its 2 entries to index, about \\d+ tokens\\.`));
  expect(shownIn(first)).toEqual([]);

  // The plan is kept with the job, each batch by its entries' ids.
  const kept = (await b.turns.env.store.get({ user: USER }, `rpe/lore-batches/${Buffer.from(started.id, "utf8").toString("base64url")}`)) as { chat: string; batches: string[][] } | undefined;
  expect(kept?.chat).toBe(CHAT);
  expect(kept?.batches.map((ids) => ids.length)).toEqual([2, 2, 2]);

  // Each piece's first request holds its own batch and none of the others'.
  for (const n of [1, 2, 3]) {
    const own = requests.find((text) => text.includes(`BATCH-${n} `)) ?? "";
    expect({ n, shown: shownIn(own).map((e) => e.id) }).toEqual({ n, shown: kept?.batches[n - 1] ?? [] });
    const others = ENTRIES.filter((e) => !shownIn(own).some((s) => s.title === e.title));
    for (const e of others) expect({ n, holds: own.includes(e.content) }).toEqual({ n, holds: false });
    expect(own).not.toContain("This job's plan:");
    // Its notes file, shared by the pieces, is in the job's session folder.
    expect(own).toMatch(/sessions\/[^/\s]+\/scratch\/task-[^\s]+-notes\.md/);
  }

  // A number the plan does not have is answered with the numbers it has.
  const missing = requests.find((text) => text.includes("BATCH-9 ")) ?? "";
  expect(missing).toContain("There is no batch 9: this job's plan numbers its batches 1 to 3.");
  expect(shownIn(missing)).toEqual([]);

  // Nothing is indexed twice, and every entry is indexed.
  expect(written.length).toBe(ENTRIES.length);
  expect(new Set(written).size).toBe(ENTRIES.length);
  expect(await b.turns.facts.read({ user: USER, chat: CHAT, session: NO_SESSION }, ["lore.unindexed"])).toEqual({ "lore.unindexed": { count: 0 } });
});
