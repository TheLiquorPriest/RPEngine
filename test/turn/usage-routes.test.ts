// The routes of the use of the models (`src/turn/usage-routes.ts`), called as the server calls them, each reply held to its
// declaration: a turn's use, agent by agent with what each was handed and its calls by part, and the job its run started beside it
// with its own use; a continue that joined a turn counted with it, and its held turn answered as joined; a span of turns or of time
// summed by operation and by part; and what was played before the rows were kept read in from the kept traces on a press, each call
// with its totals and no parts. Every name and every figure is invented.

import { afterEach, expect, test } from "bun:test";
import type { RunScope, TraceRecord } from "rp-harness/contract";
import { RouteError } from "../../src/app";
import { readConfig } from "../../src/app/config-read";
import type { ApiRoutes } from "../../src/shared/api";
import { JoinedTurnError } from "../../src/store";
import { kvStore } from "../../src/turn";
import { type Run, type RunRecord, Runs } from "../../src/turn/runs";
import { usageRoutes } from "../../src/turn/usage-routes";
import { callRoute } from "../app/call";
import { AUTHOR, before, CHAT, CLERK_1, GM, JOB, jobRecord, jobScope, RUN, SCOPE, SESSION, T0, TURN, turnRecords, USER, type UsageBed, usageBed } from "./usage-rig";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type TurnUse = ApiRoutes["GET /api/v1/chats/:chat/turns/:turn/use"]["reply"];
type UsageSpan = ApiRoutes["GET /api/v1/usage"]["reply"];
type ReadIn = ApiRoutes["POST /api/v1/usage/read-in"]["reply"];

/** The status a route refused with; null where it answered, or failed in another way. */
const refusal = (asked: Promise<unknown>): Promise<number | null> =>
  asked.then(
    () => null,
    (error: unknown) => (error instanceof RouteError ? error.status : null),
  );

/** A folder RPE keeps a trace in, by its place below the chat: the session, then the turn. */
const folderOf = (scope: RunScope): string => `${scope.session}/${scope.turn ?? ""}`;

interface Page {
  b: UsageBed;
  /** What each folder keeps, by folder; a folder in `unreadable` cannot be read, and each read is noted in `read`. */
  kept: Map<string, TraceRecord[]>;
  unreadable: Set<string>;
  read: string[];
  /** The turns with a run going on now. */
  going: Set<string>;
  /** The turns the store holds as joined to another, each with the turn it joined. */
  joined: Map<string, string>;
  /** Keeps records as RPE's trace does: each in the folder of its scope's session and turn. */
  keeps(records: readonly TraceRecord[]): void;
  /** Keeps a run of RPE's as it stands. */
  played(run: Partial<RunRecord> & Pick<RunRecord, "id" | "turn" | "received">): Promise<void>;
  use(turn: string, chat?: string, user?: string): Promise<TurnUse>;
  span(query?: Record<string, string | number>, user?: string): Promise<UsageSpan>;
  readIn(): Promise<ReadIn>;
}

const pages: Page[] = [];
afterEach(async () => {
  for (const p of pages.splice(0)) await p.b.close();
});

async function page(): Promise<Page> {
  const b = await usageBed();
  const runs = new Runs(b.db, b.writes);
  const kept = new Map<string, TraceRecord[]>();
  const unreadable = new Set<string>();
  const read: string[] = [];
  const going = new Set<string>();
  const joined = new Map<string, string>();
  const [use, span, readIn] = usageRoutes({
    calls: b.calls,
    runs: {
      ofTurn: (user, turn) => runs.ofTurn(user, turn),
      newestPlayed: (user, count, within) => runs.newestPlayed(user, count, within),
      playedFolders: (user) => runs.playedFolders(user),
      running: (_user, turn) => (going.has(turn) ? ({} as Run) : undefined),
    },
    db: b.db,
    turn: (_user, turn) => (joined.has(turn) ? { chat: CHAT, joined: joined.get(turn) ?? "" } : null),
    kept: async (scope: RunScope) => {
      const folder = folderOf(scope);
      read.push(folder);
      if (unreadable.has(folder)) throw new Error("the folder cannot be read");
      return kept.get(folder) ?? [];
    },
    shared: () => readConfig([], null),
    log: b.log,
  });
  const p: Page = {
    b,
    kept,
    unreadable,
    read,
    going,
    joined,
    keeps: (records) => {
      for (const record of records) kept.set(folderOf(record.scope), [...(kept.get(folderOf(record.scope)) ?? []), record]);
    },
    played: async (run) => {
      const record: RunRecord = {
        traceRun: null,
        user: USER,
        chat: CHAT,
        session: SESSION,
        generation: null,
        target: null,
        swipe: null,
        kind: "new",
        status: "released",
        started: run.received,
        firstWord: null,
        released: null,
        finished: null,
        ended: run.received + 10_000,
        intent: null,
        thinking: [],
        withoutIntent: false,
        intake: null,
        wait: null,
        folder: null,
        usage: null,
        lookups: { searches: 0, reads: 0 },
        reply: "",
        progress: [],
        error: null,
        stoppedBy: null,
        lastText: false,
        notGiven: [],
        base: "",
        saved: null,
        settled: null,
        held: null,
        mark: null,
        intentRecord: null,
        ...run,
      };
      await b.writes.run((db) => runs.put(db, record));
    },
    use: (turn, chat = CHAT, user = USER) => callRoute(use, { params: { chat, turn }, user }),
    span: (query = {}, user = USER) => callRoute(span, { query, user }),
    readIn: () => callRoute(readIn, { user: USER }),
  };
  pages.push(p);
  return p;
}

test("a turn's use is its agents, each with what it was handed and its calls by part, and the job its run started beside it with its own use", async () => {
  const p = await page();
  await p.played({ id: "r-ferry", turn: TURN, received: T0 - 500, traceRun: RUN });
  for (const record of turnRecords()) p.b.calls.record(record);
  // The job's own record, as RPH keeps it: what ties the job to the turn that started it.
  await kvStore(p.b.db, p.b.writes).jobs.set(SCOPE, jobRecord());

  const use = await p.use(TURN);
  expect(use.turn).toBe(TURN);
  // The turn's own runs: the Author's two calls and the GM's one. The job's call is its own.
  expect(use.spent).toEqual({ calls: 3, input: 22_800, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 1_350, reasoning: 120 });
  expect(use.agents.map((a) => [a.definition, a.run, a.spent.calls, a.spent.input, a.calls.map((c) => c.n)])).toEqual([
    ["author", RUN, 2, 18_800, [1, 2]],
    ["gm", RUN, 1, 4_000, [1]],
  ]);
  const [author, gm] = use.agents;
  expect(author?.sent).toEqual([
    {
      at: T0 + 1,
      items: [
        { name: "briefing", tokens: 1_900, from: "definition" },
        { name: "prompt:*", tokens: 5_200, from: "definition" },
      ],
    },
  ]);
  expect(author?.calls[0]).toEqual({
    n: 1,
    operation: "lead",
    purpose: null,
    model: "model-gull",
    connection: "conn-harbor",
    api: "harbor-messages",
    effort: "high",
    started: T0 + 10,
    ended: T0 + 4_010,
    sinceLast: null,
    input: 9_000,
    cacheRead: 0,
    cacheWrite: 8_200,
    output: 300,
    reasoning: 120,
    parts: [
      { part: "opening", chars: 6_000, tokens: 1_500 },
      { part: "prompt", name: "lore", chars: 8_000, tokens: 2_000 },
      { part: "briefing", name: "world-state", chars: 7_600, tokens: 1_900 },
    ],
    cache: { asked: "long", marks: [{ at: "system", index: 0, lifetime: "long" }] },
    stop: "toolUse",
    error: null,
  });
  // A call that read nothing from the cache though its agent had sent this front before says so, with why.
  expect(author?.calls[1]).toMatchObject({ n: 2, sinceLast: 2_190, cacheRead: 8_200, cache: { asked: "long", cold: true, cause: "changed" } });
  expect(gm).toMatchObject({ agent: GM.id, plays: null, sent: [{ at: T0 + 4_020, items: [{ name: "world:scene(full, map)", tokens: 2_100, from: "definition" }, { name: "story:brief", tokens: 400, from: "caller" }] }] });
  expect(gm?.calls[0]).toMatchObject({ operation: "sub", purpose: "Can the ferry cross tonight?", cache: { asked: "short" } });

  // The job the Author started, beside the turn: its row as a list of jobs shows it, and its own agent's call.
  expect(use.jobs).toEqual([
    {
      id: JOB,
      job: { id: JOB, agent: "historian", brief: "Tally the tide tables.", state: "done", scope: jobScope(JOB), startedBy: AUTHOR, started: T0 + 6_100, ended: T0 + 9_612, usage: CLERK_1 },
      spent: { calls: 1, input: 2_500, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0, output: 800, reasoning: 0 },
      agents: [expect.objectContaining({ run: JOB, definition: "historian", sent: [], calls: [expect.objectContaining({ n: 1, operation: "job", input: 2_500, output: 800 })] })],
    },
  ]);

  // A job whose record RPE no longer keeps is still beside its turn, by the rows of its calls.
  await p.b.writes.run((db) => db.run("DELETE FROM job WHERE user = ? AND id = ?", [USER, JOB]));
  expect((await p.use(TURN)).jobs.map((j) => [j.id, j.job, j.spent.calls, j.agents.length])).toEqual([[JOB, null, 1, 1]]);

  // A turn the chat does not have, another chat's, another user's: none of them is read.
  expect(await Promise.all([refusal(p.use("turn-nowhere")), refusal(p.use(TURN, "chat-elsewhere")), refusal(p.use(TURN, CHAT, "user-other"))])).toEqual([404, 404, 404]);
});

test("a continue that joined a turn is counted with it, and its own held turn is answered as joined", async () => {
  const p = await page();
  await p.played({ id: "r-ferry", turn: TURN, received: T0 - 500, traceRun: RUN });
  // The continue played under a turn of its own, which joined the turn it extended: its records name the held turn.
  await p.played({ id: "r-continue", turn: TURN, held: "turn-held", kind: "continue", received: T0 + HOUR - 500, traceRun: "run-continue" });
  for (const record of [...turnRecords(), ...turnRecords({ turn: "turn-held", run: "run-continue", job: "job-second", at: HOUR })]) p.b.calls.record(record);

  const use = await p.use(TURN);
  expect(use.spent.calls).toBe(6);
  expect(use.agents.map((a) => [a.run, a.definition])).toEqual([
    [RUN, "author"],
    [RUN, "gm"],
    ["run-continue", "author"],
    ["run-continue", "gm"],
  ]);
  expect(use.jobs.map((j) => j.id)).toEqual([JOB, "job-second"]);

  p.joined.set("turn-held", TURN);
  expect(await p.use("turn-held").then(() => null, (error: unknown) => error)).toBeInstanceOf(JoinedTurnError);
});

test("a span is summed in all and by operation, by part, by definition, by chat and by day: of his newest turns, or of a stretch of time", async () => {
  const p = await page();
  await p.played({ id: "r-ferry", turn: TURN, received: T0 - 500, traceRun: RUN });
  await p.played({ id: "r-landing", turn: "turn-landing", received: T0 + 5 * HOUR - 500, traceRun: "run-landing" });
  for (const record of [...turnRecords(), ...turnRecords({ turn: "turn-landing", run: "run-landing", job: "job-landing", at: 5 * HOUR })]) p.b.calls.record(record);

  // The newest turn: its runs' calls and its job's.
  const newest = await p.span({ turns: 1 });
  expect(newest).toMatchObject({ turns: 1, from: T0 + 5 * HOUR - 500, to: null, withParts: 4 });
  expect(newest.total).toEqual({ calls: 4, input: 25_300, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 2_150, reasoning: 120 });
  expect(newest.byOperation.map((o) => [o.operation, o.spent.calls, o.spent.input, o.spent.output])).toEqual([
    ["lead", 2, 18_800, 750],
    ["sub", 1, 4_000, 600],
    ["job", 1, 2_500, 800],
  ]);
  expect(newest.byPart.map((part) => [part.part, part.name, part.calls, part.tokens])).toEqual([
    ["opening", null, 4, 4_800],
    ["prompt", "lore", 2, 4_000],
    ["briefing", "world-state", 1, 1_900],
    ["results", "delegate", 1, 600],
    ["given", "story:brief", 1, 400],
    ["brief", null, 2, 130],
  ]);
  expect(newest.byDefinition.map((d) => [d.definition, d.spent.calls])).toEqual([
    ["author", 2],
    ["gm", 1],
    ["historian", 1],
  ]);
  expect(newest.byChat.map((c) => [c.chat, c.spent.calls])).toEqual([[CHAT, 4]]);
  // The turn began at one in the morning by UTC; counted five hours west, it is the evening before.
  expect(newest.byDay.map((d) => [d.day, d.spent.calls])).toEqual([["2031-03-10", 4]]);
  expect((await p.span({ turns: 1, offset: -300 })).byDay.map((d) => [d.day, d.spent.calls])).toEqual([["2031-03-09", 4]]);

  // The span before it is asked with where this one begins; more turns than were played gives those there are.
  const earlier = await p.span({ turns: 1, to: newest.from ?? 0 });
  expect(earlier).toMatchObject({ turns: 1, from: T0 - 500, to: T0 + 5 * HOUR - 500, total: { calls: 4 } });
  expect(await p.span({ turns: 10 })).toMatchObject({ turns: 2, from: T0 - 500, total: { calls: 8, input: 50_600 } });
  expect(await p.span({ turns: 10, chat: "chat-elsewhere" })).toMatchObject({ turns: 0, from: null, total: { calls: 0 } });

  // A stretch of time counts the calls that began in it, whatever turn they are of.
  expect(await p.span({ from: T0, to: T0 + 6_150 })).toMatchObject({ turns: null, from: T0, to: T0 + 6_150, total: { calls: 3, input: 15_500 } });
  expect((await p.span()).total.calls).toBe(8);
  expect((await p.span({ chat: "chat-elsewhere" })).total.calls).toBe(0);
  // Another user's calls are none of his.
  expect((await p.span({}, "user-other")).total.calls).toBe(0);
});

test("what was played before the rows were kept is read in from the kept traces on a press: each call with its totals and no parts, once", async () => {
  const p = await page();
  const jobs = kvStore(p.b.db, p.b.writes).jobs;
  // A turn of an earlier build and the job it started, each with its trace as that build kept it, the job's under its own session.
  await p.played({ id: "r-old", turn: "turn-old", received: T0 - 2 * DAY - 500, traceRun: "run-old" });
  await jobs.set(SCOPE, jobRecord("job-old", "turn-old", -2 * DAY));
  p.keeps(before(turnRecords({ turn: "turn-old", run: "run-old", job: "job-old", at: -2 * DAY })));
  // A turn whose folder cannot be read.
  await p.played({ id: "r-torn", turn: "turn-torn", received: T0 - DAY - 500, traceRun: "run-torn" });
  p.unreadable.add(`${SESSION}/turn-torn`);
  // Today's turn and its job, with their rows; a turn going on, and a job that has not ended; a turn and a job a migration carried.
  await p.played({ id: "r-ferry", turn: TURN, received: T0 - 500, traceRun: RUN });
  await jobs.set(SCOPE, jobRecord());
  for (const record of turnRecords()) p.b.calls.record(record);
  await p.b.calls.settled();
  await p.played({ id: "r-going", turn: "turn-going", received: T0 + HOUR, traceRun: "run-going", status: "running", ended: null });
  p.going.add("turn-going");
  p.keeps(turnRecords({ turn: "turn-going", run: "run-going", job: "job-going", at: HOUR }));
  const { ended: _ended, ...running } = jobRecord("job-going", "turn-going", HOUR);
  await jobs.set(SCOPE, { ...running, state: "running" });
  await p.played({ id: "carried-turn-then", turn: "turn-then", session: "", received: T0 - 9 * DAY });
  await p.b.writes.run((db) => db.run("INSERT INTO job (user, id, started, chat, turn, state, value) VALUES (?, ?, ?, ?, ?, ?, ?)", [USER, "job-then", T0 - 9 * DAY, CHAT, null, "done", JSON.stringify({ ...jobRecord("job-then", "turn-then", -9 * DAY), carried: true })]));

  // The press reads the folders that have no row: the old turn's and its job's, and the one it cannot read.
  expect(await p.readIn()).toEqual({ turns: 1, jobs: 1, unread: 1, calls: 4, sent: 0, withoutParts: 4 });
  expect(p.read).toEqual([`${SESSION}/turn-old`, `${SESSION}/turn-torn`, "session-job-old/turn-old"]);
  expect(p.b.logged.map((l) => [l.message, l.fields?.turn, l.fields?.error])).toEqual([["A kept trace could not be read in as rows of its model calls; the next reading in tries it again.", "turn-torn", "the folder cannot be read"]]);

  // The old turn's use: its calls with their totals, no parts, and no word of what they were for; its job beside it.
  const old = await p.use("turn-old");
  expect(old.spent).toEqual({ calls: 3, input: 22_800, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 0, output: 1_350, reasoning: 120 });
  expect(old.agents.flatMap((a) => a.calls.map((c) => [a.definition, c.n, c.input, c.output, c.operation, c.parts, c.cache]))).toEqual([
    ["author", 1, 9_000, 300, null, null, null],
    ["author", 2, 9_800, 450, null, null, null],
    ["gm", 1, 4_000, 600, null, null, null],
  ]);
  expect(old.agents.map((a) => a.sent)).toEqual([[], []]);
  expect(old.jobs.map((j) => [j.id, j.job?.state, j.spent.calls, j.spent.input, j.agents.flatMap((a) => a.calls.map((c) => c.parts))])).toEqual([["job-old", "done", 1, 2_500, [null]]]);
  // Over every turn he played (the carried one is none of them), the sums by part are of the calls that carry parts alone.
  expect(await p.span({ turns: 10 })).toMatchObject({ turns: 4, total: { calls: 8 }, withParts: 4 });

  // A second press reads only what still has no row, and adds nothing twice.
  expect(await p.readIn()).toEqual({ turns: 0, jobs: 0, unread: 1, calls: 0, sent: 0, withoutParts: 0 });
  expect(p.read.slice(3)).toEqual([`${SESSION}/turn-torn`]);
  expect((await p.use("turn-old")).spent.calls).toBe(3);
});
