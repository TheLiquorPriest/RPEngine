// Each model call as a row of its own (`src/turn/usage.ts`; plan Appendix B, `call` and `agent_sent`), written from RPH's trace as
// its records pass: a call's row with its parts, what it was for and what it asked of the cache; what each agent was handed; a save
// before a compaction, which counts from 1 again under the agent's own handle; a call a stop cut off, counted by its agent's end; a
// kept trace read in once, never over a row kept as its call ran; the sums of a span with no cached token counted twice; the rows
// past the days kept removed; and the trace never held up by a write that fails. With them, the HUD's meter, which counts a turn's
// tokens as sent plus written. Every name and every figure is invented.

import { afterEach, expect, test } from "bun:test";
import type { AgentRef, Usage } from "rp-harness/contract";
import { meterOf } from "../../src/play/panel-reads";
import { CallRows } from "../../src/turn/usage";
import { answered, AUTHOR, before, calling, CHAT, ended, JOB, LEAD_1, LEAD_2, recorder, RUN, spent, started, sum, T0, TURN, turnRecords, USER, type UsageBed, usageBed } from "./usage-rig";

const beds: UsageBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(): Promise<UsageBed> {
  const b = await usageBed();
  beds.push(b);
  return b;
}

test("a call's row is written as its end passes: whose it was, what for, its tokens, its request by part and what it asked of the cache", async () => {
  const b = await bed();
  for (const record of turnRecords()) b.calls.record(record);
  await b.calls.settled();

  const rows = b.calls.ofTurns(USER, [TURN]);
  expect(rows.map((c) => [c.run, c.definition, c.n, c.operation])).toEqual([
    [RUN, "author", 1, "lead"],
    [RUN, "gm", 1, "sub"],
    [JOB, "historian", 1, "job"],
    [RUN, "author", 2, "lead"],
  ]);
  const [first, gm, clerk, second] = rows;
  expect(first).toEqual({
    run: RUN,
    agent: AUTHOR.id,
    n: 1,
    started: T0 + 10,
    ended: T0 + 4_010,
    chat: CHAT,
    turn: TURN,
    job: null,
    definition: "author",
    plays: null,
    operation: "lead",
    purpose: null,
    model: "model-gull",
    connection: "conn-harbor",
    api: "harbor-messages",
    effort: "high",
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
  // The sub-agent's call names what it was started for; the job's is tied to its job, under the job's own run and the turn that started it.
  expect(gm).toMatchObject({ purpose: "Can the ferry cross tonight?", job: null, cache: { asked: "short" } });
  expect(clerk).toMatchObject({ run: JOB, job: JOB, turn: TURN, chat: CHAT, input: 2_500, output: 800 });
  expect(second).toMatchObject({ sinceLast: 2_190, cacheRead: 8_200, cache: { asked: "long", cold: true, cause: "changed" } });

  // What each agent was handed as it started, in the order given, with who chose it.
  expect(b.calls.sentOfTurns(USER, [TURN]).map((s) => [s.definition, s.ord, s.name, s.tokens, s.from])).toEqual([
    ["author", 0, "briefing", 1_900, "definition"],
    ["author", 1, "prompt:*", 5_200, "definition"],
    ["gm", 0, "world:scene(full, map)", 2_100, "definition"],
    ["gm", 1, "story:brief", 400, "caller"],
  ]);
  // Nothing is held of a run that ended, and nothing was logged.
  expect(b.calls.held()).toEqual({ runs: 0, writes: 0 });
  expect(b.logged).toEqual([]);
});

test("a save before a compaction counts from 1 again under the agent's own handle, and neither call takes the other's row", async () => {
  const b = await bed();
  const turn = recorder(RUN);
  const save = spent(9_900, 9_000, 0, 200);
  const third = spent(3_000, 0, 2_800, 350);
  const records = [
    turn(AUTHOR, 1, started("author", { operation: "lead" })),
    turn(AUTHOR, 10, calling(1)),
    turn(AUTHOR, 2_010, answered(1, LEAD_1, 2_000)),
    turn(AUTHOR, 2_020, calling(2)),
    turn(AUTHOR, 4_020, answered(2, LEAD_2, 2_000)),
    // The save: a start of its own under the same handle, its call numbered 1, while the agent's own work waits.
    turn(AUTHOR, 4_030, started("author", { operation: "save" })),
    turn(AUTHOR, 4_040, calling(1)),
    turn(AUTHOR, 5_040, answered(1, save, 1_000)),
    turn(AUTHOR, 5_041, ended(save)),
    turn(AUTHOR, 5_100, calling(3)),
    turn(AUTHOR, 7_100, answered(3, third, 2_000)),
    turn(AUTHOR, 7_101, ended(sum(LEAD_1, LEAD_2, third))),
  ];
  for (const record of records) b.calls.record(record);
  await b.calls.settled();
  expect(b.calls.ofTurns(USER, [TURN]).map((c) => [c.n, c.operation, c.started - T0, c.input])).toEqual([
    [1, "lead", 10, 9_000],
    [2, "lead", 2_020, 9_800],
    [1, "save", 4_040, 9_900],
    [3, "lead", 5_100, 3_000],
  ]);
});

test("a call a stop cut off has no end of its own: its agent's end counts it, and a call that never went out has no row", async () => {
  const b = await bed();
  const turn = recorder(RUN);
  const cut: Usage = { calls: 1, input: 7_000, cacheRead: 6_500, cacheWrite: 0, output: 40 };
  const records = [
    turn(AUTHOR, 1, started("author", { operation: "lead" })),
    turn(AUTHOR, 10, calling(1)),
    turn(AUTHOR, 2_010, answered(1, LEAD_1, 2_000)),
    // A call refused before it was sent: RPH counts none.
    turn(AUTHOR, 2_020, calling(2)),
    turn(AUTHOR, 2_030, answered(2, { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, 10, { stop: "error", error: "no key" })),
    // A call under way when the turn was stopped: no end record, and the agent's end holds what it spent.
    turn(AUTHOR, 2_100, calling(3, { parts: [{ part: "opening", chars: 6_000, tokens: 1_500 }] })),
    turn(AUTHOR, 3_600, ended(sum(LEAD_1, cut), "stopped")),
  ];
  for (const record of records) b.calls.record(record);
  await b.calls.settled();
  const rows = b.calls.ofTurns(USER, [TURN]);
  expect(rows.map((c) => [c.n, c.stop])).toEqual([
    [1, "stop"],
    [3, "stopped"],
  ]);
  expect(rows[1]).toMatchObject({ started: T0 + 2_100, ended: T0 + 3_600, input: 7_000, cacheRead: 6_500, cacheWrite: 0, output: 40, reasoning: null, parts: [{ part: "opening", chars: 6_000, tokens: 1_500 }], cache: null });
});

test("a kept trace is read in once, with no parts where it kept none, and never over a row kept as its call ran", async () => {
  const b = await bed();
  // A turn played before the rows were kept: its trace holds each call's totals alone.
  expect(await b.calls.readIn(before(turnRecords()))).toEqual({ calls: 4, sent: 0, withoutParts: 4 });
  const old = b.calls.ofTurns(USER, [TURN]);
  expect(old.map((c) => [c.definition, c.n, c.input, c.output, c.operation, c.parts, c.cache])).toEqual([
    ["author", 1, 9_000, 300, null, null, null],
    ["gm", 1, 4_000, 600, null, null, null],
    ["historian", 1, 2_500, 800, null, null, null],
    ["author", 2, 9_800, 450, null, null, null],
  ]);
  // Read in again, nothing is added.
  expect(await b.calls.readIn(before(turnRecords()))).toEqual({ calls: 0, sent: 0, withoutParts: 0 });
  expect(b.calls.ofTurns(USER, [TURN])).toEqual(old);

  // A turn whose rows were kept as its calls ran keeps them whole when its trace is read in.
  const live = await bed();
  for (const record of turnRecords()) live.calls.record(record);
  await live.calls.settled();
  const kept = live.calls.ofTurns(USER, [TURN]);
  expect(await live.calls.readIn(before(turnRecords()))).toEqual({ calls: 0, sent: 0, withoutParts: 0 });
  expect(live.calls.ofTurns(USER, [TURN])).toEqual(kept);
  expect(kept.every((c) => c.parts !== null)).toBe(true);
  // And a trace that holds the parts gives them when it is read in.
  const whole = await bed();
  expect(await whole.calls.readIn(turnRecords())).toEqual({ calls: 4, sent: 4, withoutParts: 0 });
  expect(whole.calls.ofTurns(USER, [TURN])).toEqual(kept);
});

test("a span's calls are summed in all and by definition, operation, part, chat and day, with no cached token counted twice", async () => {
  const b = await bed();
  for (const record of turnRecords()) b.calls.record(record);
  // A job of no chat, half an hour past the next midnight by UTC, under its own run.
  const own = recorder("job-almanac", { user: USER, session: "session-almanac" });
  const clerk: AgentRef = { id: "agent-almanac", definition: "historian", job: "job-almanac" };
  const later = 4.5 * 3_600_000;
  for (const record of [own(clerk, later, started("historian", { operation: "job" })), own(clerk, later + 10, calling(1)), own(clerk, later + 1_010, answered(1, spent(1_000, 0, 0, 100), 1_000)), own(clerk, later + 1_011, ended(spent(1_000, 0, 0, 100)))]) b.calls.record(record);
  await b.calls.settled();

  const all = b.calls.sums(USER, {}, 0);
  // Sent is what RPH counted, the cached tokens among it: 9,000 + 9,800 + 4,000 + 2,500 + 1,000.
  expect(all.total).toEqual({ calls: 5, input: 26_300, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 2_250, reasoning: 120 });
  expect(all.withParts).toBe(4);
  expect(all.byDefinition.map((d) => [d.definition, d.spent.calls, d.spent.input])).toEqual([
    ["author", 2, 18_800],
    ["gm", 1, 4_000],
    ["historian", 2, 3_500],
  ]);
  expect(all.byOperation.map((o) => [o.operation, o.spent.calls, o.spent.input + o.spent.output])).toEqual([
    ["lead", 2, 19_550],
    ["sub", 1, 4_600],
    ["job", 2, 4_400],
  ]);
  expect(all.byPart).toEqual([
    { part: "opening", name: null, calls: 4, chars: 19_200, tokens: 4_800 },
    { part: "prompt", name: "lore", calls: 2, chars: 16_000, tokens: 4_000 },
    { part: "briefing", name: "world-state", calls: 1, chars: 7_600, tokens: 1_900 },
    { part: "results", name: "delegate", calls: 1, chars: 2_400, tokens: 600 },
    { part: "given", name: "story:brief", calls: 1, chars: 1_600, tokens: 400 },
    { part: "brief", name: null, calls: 2, chars: 520, tokens: 130 },
  ]);
  expect(all.byChat.map((c) => [c.chat, c.spent.calls])).toEqual([
    [CHAT, 4],
    [null, 1],
  ]);
  expect(all.byDay.map((d) => [d.day, d.spent.calls])).toEqual([
    ["2031-03-09", 4],
    ["2031-03-10", 1],
  ]);
  // Counted five hours west of UTC, the job of the next day's first half hour falls on the evening before.
  expect(b.calls.sums(USER, {}, -300).byDay.map((d) => [d.day, d.spent.calls])).toEqual([["2031-03-09", 5]]);

  // One chat's, a stretch of time, and the calls recorded under a turn.
  expect(b.calls.sums(USER, { chat: CHAT }, 0).total.calls).toBe(4);
  expect(b.calls.sums(USER, { from: T0 + 6_000, to: T0 + later }, 0).total).toMatchObject({ calls: 2, input: 12_300 });
  expect(b.calls.sums(USER, { turns: [TURN] }, 0).total.calls).toBe(4);
  expect(b.calls.sums(USER, { turns: ["turn-elsewhere"] }, 0)).toEqual({ total: { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0, output: 0, reasoning: 0 }, withParts: 0, byDefinition: [], byOperation: [], byPart: [], byChat: [], byDay: [] });
  // Another user's rows are none of his.
  expect(b.calls.sums("user-other", {}, 0).total.calls).toBe(0);
});

test("the rows of calls that began before the days kept are removed, with what the agents started then were handed", async () => {
  const b = await bed();
  for (const record of turnRecords()) b.calls.record(record);
  await b.calls.settled();
  expect(b.calls.hasOfTurn(USER, TURN)).toBe(true);
  // Before the Author's second call: its first, the GM's and the job's go, with what the Author and the GM were handed.
  expect(await b.calls.prune(USER, T0 + 6_200)).toBe(7);
  expect(b.calls.ofTurns(USER, [TURN]).map((c) => [c.definition, c.n])).toEqual([["author", 2]]);
  expect(b.calls.sentOfTurns(USER, [TURN])).toEqual([]);
  expect(await b.calls.prune("user-other", T0 + 86_400_000)).toBe(0);
  expect(await b.calls.prune(USER, T0 + 86_400_000)).toBe(1);
  expect(b.calls.hasOfTurn(USER, TURN)).toBe(false);

  // A job's calls are its own run's: with only those kept, the turn's own runs have none.
  const jobs = await bed();
  for (const record of turnRecords().filter((r) => r.run === JOB)) jobs.calls.record(record);
  await jobs.calls.settled();
  expect([jobs.calls.ofTurns(USER, [TURN]).length, jobs.calls.hasOfTurn(USER, TURN)]).toEqual([1, false]);
});

test("the trace never waits for a row: a write that fails is logged, and the record goes on", async () => {
  const b = await bed();
  const calls = new CallRows(b.db, { run: () => Promise.reject(new Error("the disk is full")) }, { debug: () => undefined, info: () => undefined, warn: () => undefined, error: (message, fields) => void b.logged.push({ message, ...(fields !== undefined ? { fields } : {}) }) });
  for (const record of turnRecords()) calls.record(record);
  // Each record was taken at once; the writes failed after.
  await calls.settled();
  expect(calls.held()).toEqual({ runs: 0, writes: 0 });
  expect(b.logged.map((l) => [l.message, l.fields?.run, l.fields?.error])).toEqual([
    ["A model call's row could not be kept; reading the turn's kept trace in brings it back.", RUN, "the disk is full"],
    ["A model call's row could not be kept; reading the turn's kept trace in brings it back.", RUN, "the disk is full"],
    ["A model call's row could not be kept; reading the turn's kept trace in brings it back.", RUN, "the disk is full"],
    ["A model call's row could not be kept; reading the turn's kept trace in brings it back.", RUN, "the disk is full"],
    ["A model call's row could not be kept; reading the turn's kept trace in brings it back.", RUN, "the disk is full"],
    ["A model call's row could not be kept; reading the turn's kept trace in brings it back.", JOB, "the disk is full"],
  ]);
});

test("the HUD's meter counts a turn's tokens as sent plus written: what was read from and written to the cache is in what was sent", async () => {
  const b = await bed();
  await b.writes.run((db) => {
    // A run as kept: 18,800 sent, of which 8,200 read from the cache and 9,100 written to it; 750 written.
    db.run("INSERT INTO usage (user, run, turn, chat, at, calls, input, cache_read, cache_write, output, reasoning, lore_searches, lore_reads) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [USER, "run-kept", TURN, CHAT, T0 + 9_202, 2, 18_800, 8_200, 9_100, 750, 120, 1, 2]);
  });
  expect(meterOf(b.db, USER, CHAT, 20)?.turn).toEqual({ calls: 2, tokens: 19_550, ms: 0, lookups: 3 });
});
