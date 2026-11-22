// The use of the models as the routes answer it, for the preview's stand-in RPE and the pages' tests (`test/ui/usage-page.test.ts`
// holds each to its route's declaration): a turn's use made from the turn as a read answers it (each call its trace holds, with
// invented parts), a job the turn started with a call that wrote the provider's cache again, and a span of calls summed each way,
// with the span before it. Weighed by the shipped weights. Every name and every figure is made up.

import type { RequestPartKind, TraceRecord } from "rp-harness/contract";
import type { AgentUse, CallShown, CallsSpent, JobRow, RequestPart, TurnReply, TurnRow, TurnUseReply, UsageReadInReply, UsageReply, UsageWeightsShown } from "../../src/shared/api";

/** The weights as RPE ships them, no connection with its own. */
export const WEIGHTS: UsageWeightsShown = { cacheRead: 0.1, cacheWrite: 1.25, cacheWriteLong: 2, output: 5, connections: [] };

/** What tokens weigh by the shipped weights: `long` of the written ones were written for the cache's long lifetime. */
export function weigh(of: { input: number; cacheRead: number; cacheWrite: number; output: number }, long = 0): number {
  return Math.round(of.input - of.cacheRead - of.cacheWrite + of.cacheRead * WEIGHTS.cacheRead + (of.cacheWrite - long) * WEIGHTS.cacheWrite + long * WEIGHTS.cacheWriteLong + of.output * WEIGHTS.output);
}

const NOTHING: CallsSpent = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0, output: 0, reasoning: 0, weighted: 0 };

const plus = (a: CallsSpent, b: CallsSpent): CallsSpent => ({
  calls: a.calls + b.calls,
  input: a.input + b.input,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cacheWriteLong: a.cacheWriteLong + b.cacheWriteLong,
  output: a.output + b.output,
  reasoning: a.reasoning + b.reasoning,
  weighted: a.weighted + b.weighted,
});

/** What calls spent, as a sum gives it. */
export function spentOf(calls: number, input: number, cacheRead: number, cacheWrite: number, output: number, reasoning = 0, long = 0): CallsSpent {
  return { calls, input, cacheRead, cacheWrite, cacheWriteLong: long, output, reasoning, weighted: weigh({ input, cacheRead, cacheWrite, output }, long) };
}

const spentBy = (calls: readonly CallShown[]): CallsSpent =>
  calls.map((c) => ({ ...spentOf(1, c.input, c.cacheRead, c.cacheWrite, c.output, c.reasoning ?? 0, c.cache?.asked === "long" ? c.cacheWrite : 0), weighted: c.weighted })).reduce(plus, NOTHING);

/** A request's make-up, part by part, as shares of what it sent: an agent's first call, and what its later calls carry besides. */
interface MadeOf {
  first: readonly (readonly [RequestPartKind, string | null, number])[];
  later: readonly (readonly [RequestPartKind, string | null, number])[];
}

const AUTHORS: MadeOf = {
  first: [["opening", null, 0.12], ["tools", null, 0.08], ["frame", null, 0.01], ["prompt", "lore", 0.2], ["prompt", "history", 0.34], ["briefing", "turn-facts", 0.06], ["briefing", "world-state", 0.14], ["carry", null, 0.05]],
  later: [["opening", null, 0.11], ["tools", null, 0.07], ["frame", null, 0.01], ["prompt", "lore", 0.18], ["prompt", "history", 0.3], ["briefing", "turn-facts", 0.05], ["briefing", "world-state", 0.12], ["carry", null, 0.04], ["said", null, 0.02], ["calls", "delegate", 0.02], ["results", "delegate", 0.08]],
};
const OTHERS: MadeOf = {
  first: [["opening", null, 0.34], ["tools", null, 0.2], ["given", "world:scene(full, map)", 0.32], ["brief", null, 0.14]],
  later: [["opening", null, 0.3], ["tools", null, 0.18], ["given", "world:scene(full, map)", 0.28], ["brief", null, 0.12], ["calls", "world_read", 0.02], ["results", "world_read", 0.1]],
};

/** A request of `input` tokens by part, in characters and in tokens. */
function partsOf(definition: string, call: number, input: number): RequestPart[] {
  const made = definition === "author" ? AUTHORS : OTHERS;
  return (call === 1 ? made.first : made.later).map(([part, name, share]) => {
    const tokens = Math.round(input * share);
    return { part, ...(name === null ? {} : { name }), chars: tokens * 4, tokens };
  });
}

/** The agents of a run with their calls, from the run's trace records: each call that ended, with its parts invented. */
function agentsOf(records: readonly TraceRecord[]): AgentUse[] {
  const agents = new Map<string, AgentUse>();
  const began = new Map<string, { at: number; connection: string; model: string }>();
  const last = new Map<string, number>();
  for (const record of records) {
    const { agent, event } = record;
    if (agent === undefined) continue;
    if (event.kind === "agent_started") {
      const lead = agent.parent === undefined;
      agents.set(agent.id, {
        run: record.run,
        agent: agent.id,
        definition: agent.definition,
        plays: agent.plays ?? null,
        spent: NOTHING,
        sent: [{ at: record.at, items: lead ? [{ name: "briefing", tokens: 2_570, from: "definition" }, { name: "prompt:*", tokens: 6_930, from: "definition" }] : [{ name: "world:scene(full, map)", tokens: 980, from: "definition" }, { name: "story:brief", tokens: 310, from: "caller" }] }],
        calls: [],
        // The lead let two things of its window go once it had begun (invented); nobody else touched theirs.
        window: lead ? [{ at: record.at + 30, action: "let_go", items: [{ id: "lore:e-12", tokens: 1_840 }, { id: "briefing:world-state", tokens: 2_310 }], spared: 4_100, once: 5_300 }] : [],
      });
    }
    if (event.kind === "call_started") began.set(`${agent.id}:${event.call}`, { at: record.at, connection: event.connection, model: event.model });
    if (event.kind !== "call_ended") continue;
    const use = agents.get(agent.id);
    const start = began.get(`${agent.id}:${event.call}`);
    if (use === undefined || start === undefined) continue;
    const before = last.get(agent.id);
    last.set(agent.id, record.at);
    use.calls.push({
      n: event.call,
      operation: agent.parent === undefined ? "lead" : "sub",
      purpose: null,
      model: start.model,
      connection: start.connection,
      api: "openai-completions",
      effort: agent.parent === undefined ? "medium" : "low",
      started: start.at,
      ended: record.at,
      sinceLast: before === undefined ? null : start.at - before,
      input: event.usage.input,
      cacheRead: event.usage.cacheRead,
      cacheWrite: event.usage.cacheWrite,
      output: event.usage.output,
      reasoning: event.usage.reasoning ?? null,
      weighted: weigh(event.usage),
      parts: partsOf(agent.definition, event.call, event.usage.input),
      cache: { asked: "short" },
      stop: event.stop,
      error: null,
    });
  }
  return [...agents.values()].map((use) => ({ ...use, spent: spentBy(use.calls) }));
}

const MINUTE = 60_000;

/**
 * The job a turn's Author started once its reply went out, as RPH keeps its record; none while the reply is not out. Its second
 * call came six minutes after its first, past the short lifetime its first asked: it read nothing from the cache and wrote it again.
 */
function jobOf(turn: TurnReply): { row: JobRow; agent: AgentUse } | null {
  const released = turn.timings.released;
  if (released === null) return null;
  const id = `job-${turn.id}-log`;
  const call = (n: number, started: number, ms: number, input: number, cacheWrite: number, output: number, more: Partial<CallShown>): CallShown => ({
    n,
    operation: "job",
    purpose: "historian",
    model: "deepseek-v4-flash",
    connection: "Deepseek",
    api: "openai-completions",
    effort: "low",
    started,
    ended: started + ms,
    sinceLast: null,
    input,
    cacheRead: 0,
    cacheWrite,
    output,
    reasoning: null,
    weighted: weigh({ input, cacheRead: 0, cacheWrite, output }),
    parts: partsOf("historian", n, input),
    cache: { asked: "short" },
    stop: n === 1 ? "toolUse" : "stop",
    error: null,
    ...more,
  });
  const first = call(1, released + 60, 2_040, 2_480, 2_200, 140, {});
  const second = call(2, first.ended + 6 * MINUTE + 12_000, 2_610, 2_960, 2_700, 210, { sinceLast: 6 * MINUTE + 12_000, cache: { asked: "short", cold: true, cause: "lapsed" } });
  const calls = [first, second];
  const spent = spentBy(calls);
  return {
    row: {
      id,
      agent: "historian",
      brief: "Note what the lamp room's log says of last night.",
      state: "done",
      scope: { user: "user-1", chat: turn.chat, session: `session-${id}`, turn: turn.id },
      startedBy: { id: "a1", definition: "author" },
      started: released + 40,
      ended: second.ended + 5,
      usage: { calls: spent.calls, input: spent.input, cacheRead: spent.cacheRead, cacheWrite: spent.cacheWrite, output: spent.output },
    },
    agent: { run: id, agent: "j1", definition: "historian", plays: null, spent, sent: [{ at: released + 45, items: [{ name: "story:record", tokens: 1_240, from: "definition" }] }], calls, window: [] },
  };
}

/** Where a turn's tokens went, as its use route answers: its runs' agents with their calls, and the job it started. */
export function turnUse(turn: TurnReply): TurnUseReply {
  const agents = turn.runs.flatMap((run) => agentsOf(run.trace));
  const job = jobOf(turn);
  return {
    turn: turn.id,
    spent: agents.map((agent) => agent.spent).reduce(plus, NOTHING),
    agents,
    jobs: job === null ? [] : [{ id: job.row.id, job: job.row, spent: job.agent.spent, agents: [job.agent] }],
    weights: WEIGHTS,
  };
}

/** The same turn with what its row tells of its use: the job it started, and what the kept rows of its calls weigh. */
export function withUse<T extends Pick<TurnRow, "jobs" | "weighted">>(row: T, turn: TurnReply): T {
  const use = turnUse(turn);
  return { ...row, jobs: use.jobs.flatMap((job) => (job.job === null ? [] : [job.job])), weighted: use.spent.calls === 0 ? null : { runs: use.spent.weighted, jobs: Object.fromEntries(use.jobs.map((job) => [job.id, job.spent.weighted])) } };
}

/** One cell of a span: the calls of one definition, for one thing, in one chat, on one day. */
interface Cell {
  definition: string;
  operation: UsageReply["byOperation"][number]["operation"];
  chat: string | null;
  day: string;
  spent: CallsSpent;
}

function by<K extends string | null>(cells: readonly Cell[], keyOf: (cell: Cell) => K): { key: K; spent: CallsSpent }[] {
  const sums = new Map<K, CallsSpent>();
  for (const cell of cells) sums.set(keyOf(cell), plus(sums.get(keyOf(cell)) ?? NOTHING, cell.spent));
  return [...sums].map(([key, spent]) => ({ key, spent })).sort((a, b) => b.spent.weighted - a.spent.weighted);
}

/** A span's reply from its cells and its parts. */
function spanOf(cells: readonly Cell[], parts: UsageReply["byPart"], over: Pick<UsageReply, "from" | "to" | "turns" | "withParts">): UsageReply {
  return {
    ...over,
    total: cells.map((cell) => cell.spent).reduce(plus, NOTHING),
    byDefinition: by(cells, (cell) => cell.definition).map(({ key, spent }) => ({ definition: key, spent })),
    byOperation: by(cells, (cell) => cell.operation).map(({ key, spent }) => ({ operation: key, spent })),
    byPart: [...parts].sort((a, b) => b.tokens - a.tokens),
    byChat: by(cells, (cell) => cell.chat).map(({ key, spent }) => ({ chat: key, spent })),
    byDay: by(cells, (cell) => cell.day)
      .map(({ key, spent }) => ({ day: key, spent }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    weights: WEIGHTS,
    kept: null,
  };
}

const DAY = 24 * 60 * MINUTE;
/** Midday of the day the recorded turn was played, 12 Nov 2026 by UTC. */
const NOON = Date.UTC(2026, 10, 12, 12, 0, 0);

/** The span shown: twenty turns of two chats over three days, nine of its calls read in from old traces with their totals alone. */
export const SPAN: UsageReply = spanOf(
  [
    { definition: "author", operation: "lead", chat: "chat-calder", day: "2026-11-10", spent: spentOf(14, 212_400, 171_300, 18_200, 5_180, 1_320) },
    { definition: "author", operation: "lead", chat: "chat-calder", day: "2026-11-11", spent: spentOf(19, 298_700, 246_100, 22_900, 7_420, 1_910) },
    { definition: "author", operation: "lead", chat: "chat-lantern", day: "2026-11-12", spent: spentOf(12, 176_900, 139_800, 21_400, 4_630, 1_040) },
    { definition: "author", operation: "save", chat: "chat-calder", day: "2026-11-11", spent: spentOf(1, 31_200, 0, 0, 1_480) },
    { definition: "character", operation: "sub", chat: "chat-calder", day: "2026-11-10", spent: spentOf(22, 96_800, 61_900, 19_700, 3_050) },
    { definition: "character", operation: "sub", chat: "chat-calder", day: "2026-11-11", spent: spentOf(31, 141_200, 97_300, 24_600, 4_410) },
    { definition: "character", operation: "job", chat: "chat-lantern", day: "2026-11-12", spent: spentOf(17, 88_300, 49_200, 27_800, 3_920) },
    { definition: "gm", operation: "sub", chat: "chat-calder", day: "2026-11-11", spent: spentOf(16, 51_900, 40_200, 4_300, 1_180) },
    { definition: "gm", operation: "sub", chat: "chat-lantern", day: "2026-11-12", spent: spentOf(9, 27_400, 19_800, 3_100, 640) },
    { definition: "historian", operation: "job", chat: null, day: "2026-11-12", spent: spentOf(4, 12_300, 0, 9_800, 1_760) },
  ],
  [
    { part: "prompt", name: "history", calls: 46, chars: 1_043_200, tokens: 260_800 },
    { part: "prompt", name: "lore", calls: 46, chars: 596_000, tokens: 149_000 },
    { part: "opening", name: null, calls: 136, chars: 590_400, tokens: 147_600 },
    { part: "briefing", name: "world-state", calls: 45, chars: 401_200, tokens: 100_300 },
    { part: "tools", name: null, calls: 136, chars: 371_200, tokens: 92_800 },
    { part: "given", name: "world:scene(full, map)", calls: 78, chars: 318_800, tokens: 79_700 },
    { part: "results", name: "delegate", calls: 31, chars: 244_400, tokens: 61_100 },
    { part: "briefing", name: "turn-facts", calls: 45, chars: 168_400, tokens: 42_100 },
    { part: "carry", name: null, calls: 45, chars: 142_000, tokens: 35_500 },
    { part: "brief", name: null, calls: 90, chars: 128_800, tokens: 32_200 },
  ],
  { from: NOON - 2 * DAY, to: null, turns: 20, withParts: 136 },
);

/** The span before it: the briefing's world state was larger then, the chat's history smaller, and no character job had run. */
export const SPAN_BEFORE: UsageReply = spanOf(
  [
    { definition: "author", operation: "lead", chat: "chat-calder", day: "2026-11-08", spent: spentOf(21, 341_800, 262_400, 41_300, 8_050, 2_240) },
    { definition: "author", operation: "lead", chat: "chat-calder", day: "2026-11-09", spent: spentOf(18, 287_300, 219_700, 36_800, 6_870, 1_630) },
    { definition: "character", operation: "sub", chat: "chat-calder", day: "2026-11-08", spent: spentOf(27, 118_900, 79_400, 22_300, 3_760) },
    { definition: "character", operation: "sub", chat: "chat-calder", day: "2026-11-09", spent: spentOf(24, 103_600, 70_100, 18_900, 3_280) },
    { definition: "gm", operation: "sub", chat: "chat-calder", day: "2026-11-09", spent: spentOf(19, 62_700, 47_900, 6_200, 1_390) },
    { definition: "place", operation: "sub", chat: "chat-calder", day: "2026-11-08", spent: spentOf(3, 9_600, 0, 7_400, 520) },
  ],
  [
    { part: "prompt", name: "history", calls: 39, chars: 871_200, tokens: 217_800 },
    { part: "briefing", name: "world-state", calls: 39, chars: 702_000, tokens: 175_500 },
    { part: "prompt", name: "lore", calls: 39, chars: 608_400, tokens: 152_100 },
    { part: "opening", name: null, calls: 112, chars: 486_800, tokens: 121_700 },
    { part: "tools", name: null, calls: 112, chars: 305_600, tokens: 76_400 },
    { part: "given", name: "world:scene(full, map)", calls: 73, chars: 297_600, tokens: 74_400 },
    { part: "results", name: "delegate", calls: 28, chars: 221_200, tokens: 55_300 },
    { part: "briefing", name: "turn-facts", calls: 39, chars: 146_000, tokens: 36_500 },
    { part: "brief", name: null, calls: 73, chars: 104_400, tokens: 26_100 },
    { part: "summary", name: null, calls: 2, chars: 19_200, tokens: 4_800 },
  ],
  { from: NOON - 4 * DAY, to: NOON - 2 * DAY, turns: 20, withParts: 112 },
);

/** A span as the usage route answers what a page asks: the one shown, or with `to` the one before it. One chat's is not told apart from every chat's here. */
export function usageSpan(query: { turns: number | null; from: number | null; to: number | null }): UsageReply {
  const span = query.to === null ? SPAN : SPAN_BEFORE;
  return query.turns === null ? { ...span, turns: null, from: query.from ?? span.from, to: query.to } : span;
}

/** What a reading in found: three turn folders and a job from before the rows were kept, their calls with their totals alone. */
export const READ_IN: UsageReadInReply = { turns: 3, jobs: 1, unread: 0, calls: 9, sent: 0, withoutParts: 9 };
