// The routes of the use of the models (`src/turn/usage-routes.ts`), called as the server calls them, each reply held to its
// declaration: a turn's use, agent by agent with what each was handed and its calls by part, and the job its run started beside it
// with its own use; what an agent did to its own window, read from the trace its folder keeps; a continue that joined a turn
// counted with it, and its held turn answered as joined; a span of turns or of time summed by operation and by part; the weighted
// figure beside every sum and every call, by the weights the settings hold as the route answers; and what was played before the
// rows were kept read in from the kept traces on a press, each call with its totals and no parts. Every name and every figure is
// invented.

import { afterEach, expect, test } from "bun:test";
import { RouteError } from "../../src/app";
import { JoinedTurnError } from "../../src/store";
import { kvStore } from "../../src/turn";
import { AUTHOR, before, CHAT, CLERK_1, GM, JOB, jobRecord, jobScope, recorder, RUN, SCOPE, SESSION, T0, TURN, turnRecords, USER, type UsagePages, usagePages } from "./usage-rig";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The status a route refused with; null where it answered, or failed in another way. */
const refusal = (asked: Promise<unknown>): Promise<number | null> =>
  asked.then(
    () => null,
    (error: unknown) => (error instanceof RouteError ? error.status : null),
  );

const pages: UsagePages[] = [];
afterEach(async () => {
  for (const p of pages.splice(0)) await p.b.close();
});

async function page(): Promise<UsagePages> {
  const p = await usagePages();
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
  // The turn's own runs: the Author's two calls and the GM's one. The job's call is its own. Weighed as shipped: the Author's
  // 18,700 and 5,570 (its cache written for the long lifetime, at 2), and the GM's 7,000.
  expect(use.spent).toEqual({ calls: 3, input: 22_800, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 1_350, reasoning: 120, weighted: 31_270 });
  expect(use.weights).toEqual({ cacheRead: 0.1, cacheWrite: 1.25, cacheWriteLong: 2, output: 5, connections: [] });
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
    weighted: 18_700,
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
      spent: { calls: 1, input: 2_500, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0, output: 800, reasoning: 0, weighted: 6_500 },
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
  expect(newest.total).toEqual({ calls: 4, input: 25_300, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 2_150, reasoning: 120, weighted: 37_770 });
  expect(newest.byOperation.map((o) => [o.operation, o.spent.calls, o.spent.input, o.spent.output, o.spent.weighted])).toEqual([
    ["lead", 2, 18_800, 750, 24_270],
    ["sub", 1, 4_000, 600, 7_000],
    ["job", 1, 2_500, 800, 6_500],
  ]);
  // The weights it was worked out by are told with it; the rows are kept for good, so nothing is said of how long.
  expect(newest.weights).toEqual({ cacheRead: 0.1, cacheWrite: 1.25, cacheWriteLong: 2, output: 5, connections: [] });
  expect(newest.kept).toBeNull();
  // A weight changed in the settings changes the figure at the next read, for the rows already kept; and where the rows are kept
  // for a number of days alone, the setting is named with its value.
  p.config.text = "usage:\n  rowsKeptDays: 30\n  weights:\n    output: 1\n";
  expect(await p.span({ turns: 1 })).toMatchObject({ total: { output: 2_150, weighted: 37_770 - 4 * 2_150 }, weights: { output: 1 }, kept: { setting: "usage.rowsKeptDays", name: "Rows of model calls kept", days: 30 } });
  // A connection's own weights, set under its id, weigh the calls its name carries.
  p.connections.push({ id: "harbor-id", name: "conn-harbor" });
  p.config.text = "connections:\n  harbor-id:\n    usage:\n      weights:\n        cacheRead: 0\n";
  expect(await p.span({ turns: 1 })).toMatchObject({ total: { weighted: 37_770 - 820 }, weights: { cacheRead: 0.1, connections: [{ connection: "conn-harbor", cacheRead: 0, cacheWrite: 1.25, cacheWriteLong: 2, output: 5 }] } });
  expect((await p.use("turn-landing")).spent.weighted).toBe(31_270 - 820);
  p.config.text = "";
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
  // Its trace told nothing of the cache, so what was written to it is weighed as written for the short lifetime.
  expect(old.spent).toEqual({ calls: 3, input: 22_800, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 0, output: 1_350, reasoning: 120, weighted: 24_445 });
  expect(old.agents.flatMap((a) => a.calls.map((c) => [a.definition, c.n, c.input, c.output, c.operation, c.parts, c.cache]))).toEqual([
    ["author", 1, 9_000, 300, null, null, null],
    ["author", 2, 9_800, 450, null, null, null],
    ["gm", 1, 4_000, 600, null, null, null],
  ]);
  expect(old.agents.map((a) => a.sent)).toEqual([[], []]);
  expect(old.jobs.map((j) => [j.id, j.job?.state, j.spent.calls, j.spent.input, j.agents.flatMap((a) => a.calls.map((c) => c.parts))])).toEqual([["job-old", "done", 1, 2_500, [null]]]);
  // Over every turn he played (the carried one is none of them), the sums by part are of the calls that carry parts alone.
  expect(await p.span({ turns: 10 })).toMatchObject({ turns: 4, total: { calls: 8 }, withParts: 4 });

  // A second press reads only what still has no row, and adds nothing twice. (A turn's use reads its folder too, for what its agents did to their windows.)
  const readBefore = p.read.length;
  expect(await p.readIn()).toEqual({ turns: 0, jobs: 0, unread: 1, calls: 0, sent: 0, withoutParts: 0 });
  expect(p.read.slice(readBefore)).toEqual([`${SESSION}/turn-torn`]);
  expect((await p.use("turn-old")).spent.calls).toBe(3);
});

test("what an agent did to its own window is read from the trace its turn's folder keeps, and set with the agent whose it is; a folder that cannot be read gives none", async () => {
  const p = await page();
  await p.played({ id: "r-ferry", turn: TURN, received: T0 - 500, traceRun: RUN });
  for (const record of turnRecords()) p.b.calls.record(record);
  // The Author let two things go between its two calls, and brought one back after the second; the trace keeps both.
  const turn = recorder(RUN, SCOPE, T0);
  p.keeps([
    turn(AUTHOR, 4_500, { kind: "window", action: "let_go", items: [{ id: "lore:e-12", tokens: 1_840 }, { id: "briefing:world-state", tokens: 1_900 }], sparedTokens: 3_700, costTokens: 4_800 }),
    turn(AUTHOR, 9_190, { kind: "window", action: "restore", items: [{ id: "lore:e-12", tokens: 1_840 }], sparedTokens: -1_820, costTokens: 2_300 }),
  ]);
  const use = await p.use(TURN);
  const [author, gm] = use.agents;
  expect(author?.window).toEqual([
    { at: T0 + 4_500, action: "let_go", items: [{ id: "lore:e-12", tokens: 1_840 }, { id: "briefing:world-state", tokens: 1_900 }], spared: 3_700, once: 4_800 },
    { at: T0 + 9_190, action: "restore", items: [{ id: "lore:e-12", tokens: 1_840 }], spared: -1_820, once: 2_300 },
  ]);
  expect(gm?.window).toEqual([]);

  // The folder gone unreadable: the use is still answered from the rows, with no change to any window, and the log says which folder.
  p.unreadable.add(`${SESSION}/${TURN}`);
  const without = await p.use(TURN);
  expect(without.spent).toEqual(use.spent);
  expect(without.agents.map((a) => a.window)).toEqual([[], []]);
  expect(p.b.logged.map((l) => [l.message, l.fields?.turn])).toEqual([["A kept trace could not be read for what its agents did to their windows.", TURN]]);
});
