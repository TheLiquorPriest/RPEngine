// The use of the models, call by call (plan Appendix B, `call` and `agent_sent`): a row for each model call an agent made (whose it
// was, what it was for, on what, when, its tokens, its request by part and what it asked of the provider's cache), and a row for each
// item an agent was handed as it started, both written from RPH's trace as its records pass. The trace never waits for a row: each is
// queued on the application's write queue as its record passes, and a write that fails is logged and costs that row alone. The call
// stays in the trace its run keeps; a reading in (`readIn`, on the Usage page's press) adds it only where its turn or job has no row.
//
// A row is keyed by its run (RPH's own id for it; a job's run is the job's id), its agent's handle, the call's number and when its
// request went out, and carries its chat and the turn its run played in as its records' scope named them (a continue's own held
// turn; none for a job of no turn). Nothing ties a row to a turn the store holds, so a row stays when its turn is swiped away or
// deleted. What a run spent in all stays a row of `usage` (`runs.ts`), read as before.
//
// An agent's calls are told apart by its starts: its own work, the save before a compaction (which runs under the agent's own handle
// and numbers its calls from 1 again), a message that continues it. Each start names what its calls are for. A call a stop or a limit
// cut off has no end of its own in the trace: its agent's end counts it (what the agent spent beyond its calls that ended, as RPH's
// own book counts it), and its row is written then.
//
// RPH's `input` already holds the tokens read from and written to the provider's cache (`Usage`): no sum here adds them again.
//
// Beside the tokens as counted, every sum gives one weighted figure (plan §4 "The pages show"): each token sent fresh counted 1, and
// each read from the cache, written to it and written by the model counted by a weight. The weights are the user's settings, given
// to each read (`UsageWeights`), a connection's own standing over them for its calls; the figure is worked out as it is read, so a
// weight changed changes it for every row kept. It is tokens weighed, never money.

import type { Database } from "bun:sqlite";
import type { AgentOperation, CallCache, Effort, Log, RequestPart, RequestPartKind, SentItem, TraceRecord, Usage } from "rp-harness/contract";
import type { Writes } from "./kv";

/** One model call as its row keeps it. */
export interface CallRow {
  /** RPH's own id for its run; a job's run is the job's id. */
  run: string;
  /** Its agent's handle. */
  agent: string;
  /** Its number as its agent counted it, from 1; a save before a compaction counts from 1 again under the agent's own handle. */
  n: number;
  /** When its request went out, and when its answer ended (for a call cut off, when its agent ended). */
  started: number;
  ended: number;
  /** Where its run played, as its records' scope named it: the chat (none for a job of no chat) and the turn (a continue's own held turn; none for a job of no turn). */
  chat: string | null;
  turn: string | null;
  /** The job its agent worked for; null for an agent of a turn's run. */
  job: string | null;
  definition: string;
  plays: string | null;
  /** What it was for, as its agent's start named it; null in a row from a record made before RPH named it. */
  operation: AgentOperation | null;
  /** The purpose its agent was started for, where one was known. */
  purpose: string | null;
  model: string;
  connection: string;
  /** The model layer's name for the API its connection's provider speaks. */
  api: string | null;
  effort: Effort | null;
  /** Milliseconds since its agent's last request ended; null on the agent's first. */
  sinceLast: number | null;
  /** Tokens sent, those read from and written to the cache among them. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Tokens written, reasoning among them. */
  output: number;
  reasoning: number | null;
  /** Its request by part; null where its record gave none (a turn played before RPH told them). */
  parts: RequestPart[] | null;
  /** What it asked of its provider's cache and what came of it; null where its record gave none. */
  cache: CallCache | null;
  /** Why it stopped, in the provider's word; for a call cut off, how its agent ended. */
  stop: string;
  error: string | null;
}

/** One item an agent was handed as it started, as its row keeps it. */
export interface SentRow {
  run: string;
  agent: string;
  /** When the agent was started: a message that continues it hands it things again. */
  started: number;
  /** The item's place among those it was handed then, from 0. */
  ord: number;
  chat: string | null;
  turn: string | null;
  job: string | null;
  definition: string;
  name: string;
  tokens: number;
  /** Who chose it. */
  from: SentItem["from"];
}

/**
 * What each kind of token counts in the weighted figure, a token sent fresh counting 1 (plan §2: "a turn's tokens as the provider
 * weighs them"). They are the user's settings (`usage.weights.*`), shipped as the terms of one provider.
 */
export interface Weights {
  /** A token read from the provider's cache. */
  cacheRead: number;
  /** A token written to the cache by a call that did not ask the long lifetime. */
  cacheWrite: number;
  /** A token written to the cache by a call that asked the long lifetime. */
  cacheWriteLong: number;
  /** A token the model wrote, its reasoning among them. */
  output: number;
}

/** The weights as a read finds them: every connection's, and those of each connection that has its own, by the name its calls' rows carry. */
export interface UsageWeights {
  general: Weights;
  connections: ReadonlyMap<string, Weights>;
}

/** The weights the calls of a connection are weighed by: its own where it has them, else every connection's. */
export function weightsOf(weights: UsageWeights, connection: string): Weights {
  return weights.connections.get(connection) ?? weights.general;
}

/**
 * What a set of calls spent together: how many, their tokens sent (cached ones among them), read from the cache, written to it and
 * of that at the long lifetime, written, and of those the reasoning; and the same as one figure, each kind of token counted by its
 * weight as the settings stood when the sum was read.
 */
export interface Spent {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Of `cacheWrite`, the tokens of the calls that asked the provider's long lifetime. */
  cacheWriteLong: number;
  output: number;
  reasoning: number;
  /** The weighted figure, rounded to a whole number: never money. */
  weighted: number;
}

/** The calls a sum is over: of one chat, begun at or after `from` and before `to`, recorded under one of `turns`; each left out bounds nothing. */
export interface CallsOf {
  chat?: string;
  from?: number;
  to?: number;
  turns?: readonly string[];
}

/** What a span of calls spent, in all and by each way of cutting it. */
export interface SpanSums {
  total: Spent;
  /** How many of its calls carry their request by part: the sums by part are of those alone. */
  withParts: number;
  byDefinition: { definition: string; spent: Spent }[];
  byOperation: { operation: AgentOperation | null; spent: Spent }[];
  byPart: { part: RequestPartKind; name: string | null; calls: number; chars: number; tokens: number }[];
  byChat: { chat: string | null; spent: Spent }[];
  byDay: { day: string; spent: Spent }[];
}

/** The rows the records of a run complete, all one user's. */
interface Rows {
  user: string;
  calls: CallRow[];
  sent: SentRow[];
}

/** One start of an agent, while its work goes on: what its calls are for and on what, what its calls that ended have counted, and its call under way. */
interface Start {
  operation: AgentOperation | null;
  purpose: string | null;
  connection: string;
  model: string;
  api: string | null;
  effort: Effort | null;
  ended: Usage;
  open: { n: number; at: number; connection: string; model: string; parts: RequestPart[] | null; sinceLast: number | null } | null;
}

const noUsage = (): Usage => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });

/** What every row of a record's agent carries: its run, its agent and where its run played. */
function whose(record: TraceRecord & { agent: NonNullable<TraceRecord["agent"]> }): Pick<CallRow, "run" | "agent" | "chat" | "turn" | "job" | "definition"> {
  return { run: record.run, agent: record.agent.id, chat: record.scope.chat ?? null, turn: record.scope.turn ?? null, job: record.agent.job ?? null, definition: record.agent.definition };
}

/**
 * Runs followed by their records, in the order RPH gave them: each record gives the rows it completes. An agent's starts not yet
 * ended are held newest last, so a save before a compaction, started under the agent's own handle while its own work waits, takes its
 * own calls and gives the agent's work back when it ends. A run is let go when it ends (a turn's, with its `run_ended`; a job's, with
 * the view that says it ended), or once none of its agents is at work.
 */
class Followed {
  /** Each run going on, by RPH's id for it: its agents at work, by handle. */
  readonly runs = new Map<string, Map<string, Start[]>>();

  take(record: TraceRecord): Rows | null {
    const { event, agent } = record;
    if (event.kind === "run_ended") {
      this.runs.delete(record.run);
      return null;
    }
    if (event.kind === "job") {
      if (event.job.ended !== undefined) this.runs.delete(event.job.id);
      return null;
    }
    if (agent === undefined) return null;
    const of = { ...record, agent };
    const starts = this.runs.get(record.run)?.get(agent.id);
    const start = starts?.at(-1);
    switch (event.kind) {
      case "agent_started": {
        const started: Start = { operation: event.operation ?? null, purpose: event.for ?? null, connection: event.connection, model: event.model, api: event.api ?? null, effort: event.effort ?? null, ended: noUsage(), open: null };
        let agents = this.runs.get(record.run);
        if (agents === undefined) this.runs.set(record.run, (agents = new Map()));
        if (starts === undefined) agents.set(agent.id, [started]);
        else starts.push(started);
        const sent = (event.sent ?? []).map((item, ord): SentRow => ({ ...whose(of), started: record.at, ord, name: item.name, tokens: item.tokens, from: item.from }));
        return sent.length === 0 ? null : { user: record.scope.user, calls: [], sent };
      }
      case "call_started":
        if (start !== undefined) start.open = { n: event.call, at: record.at, connection: event.connection, model: event.model, parts: event.parts ?? null, sinceLast: event.sinceLast ?? null };
        return null;
      case "call_ended": {
        const open = start?.open?.n === event.call ? start.open : null;
        if (start !== undefined) {
          const { ended } = start;
          ended.calls += event.usage.calls;
          ended.input += event.usage.input;
          ended.cacheRead += event.usage.cacheRead;
          ended.cacheWrite += event.usage.cacheWrite;
          ended.output += event.usage.output;
          if (open !== null) start.open = null;
        }
        // A call whose request never went out was no call, and RPH counts none: it has no row.
        if (event.usage.calls === 0) return null;
        const call: CallRow = {
          ...whose(of),
          n: event.call,
          // By the end record alone, so that a row written as the call ran and one read in from the kept trace are one row.
          started: record.at - event.ms,
          ended: record.at,
          plays: agent.plays ?? null,
          operation: start?.operation ?? null,
          purpose: start?.purpose ?? null,
          model: event.model,
          connection: open?.connection ?? start?.connection ?? "",
          api: start?.api ?? null,
          effort: start?.effort ?? null,
          sinceLast: open?.sinceLast ?? null,
          input: event.usage.input,
          cacheRead: event.usage.cacheRead,
          cacheWrite: event.usage.cacheWrite,
          output: event.usage.output,
          reasoning: event.usage.reasoning ?? null,
          parts: open?.parts ?? null,
          cache: event.cache ?? null,
          stop: event.stop,
          error: event.error ?? null,
        };
        return { user: record.scope.user, calls: [call], sent: [] };
      }
      case "agent_ended": {
        if (starts === undefined || start === undefined) return null;
        starts.pop();
        if (starts.length === 0) {
          const agents = this.runs.get(record.run);
          agents?.delete(agent.id);
          if (agents?.size === 0) this.runs.delete(record.run);
        }
        const { open, ended } = start;
        if (open === null) return null;
        // What its work spent beyond its calls that ended: the call a stop or a limit cut off. RPH counts that call as made (its
        // request went out), so it has its row even where the provider reported no token of it.
        const rest = (count: "calls" | "input" | "cacheRead" | "cacheWrite" | "output"): number => Math.max(0, event.usage[count] - ended[count]);
        if (rest("calls") === 0 && rest("input") === 0 && rest("output") === 0) return null;
        const call: CallRow = {
          ...whose(of),
          n: open.n,
          started: open.at,
          ended: record.at,
          plays: agent.plays ?? null,
          operation: start.operation,
          purpose: start.purpose,
          model: open.model,
          connection: open.connection,
          api: start.api,
          effort: start.effort,
          sinceLast: open.sinceLast,
          input: rest("input"),
          cacheRead: rest("cacheRead"),
          cacheWrite: rest("cacheWrite"),
          output: rest("output"),
          reasoning: null,
          parts: open.parts,
          cache: null,
          stop: event.status,
          error: null,
        };
        return { user: record.scope.user, calls: [call], sent: [] };
      }
      default:
        return null;
    }
  }
}

/** Writes rows inside a queued write: over a row of the same key as a call runs, or only where none is kept as a kept trace is read in. How many of each were written. */
function put(into: Database, rows: Rows, how: "REPLACE" | "IGNORE"): { calls: number; sent: number } {
  let calls = 0;
  let sent = 0;
  for (const c of rows.calls) {
    calls += into.run(
      `INSERT OR ${how} INTO call (user, run, agent, n, started, ended, chat, turn, job, definition, plays, operation, purpose, model, connection, api, effort, since_last, input, cache_read, cache_write, output, reasoning, parts, cache, stop, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rows.user, c.run, c.agent, c.n, c.started, c.ended, c.chat, c.turn, c.job, c.definition, c.plays, c.operation, c.purpose, c.model, c.connection, c.api, c.effort, c.sinceLast, c.input, c.cacheRead, c.cacheWrite, c.output, c.reasoning, c.parts === null ? null : JSON.stringify(c.parts), c.cache === null ? null : JSON.stringify(c.cache), c.stop, c.error],
    ).changes;
  }
  for (const s of rows.sent) {
    sent += into.run(`INSERT OR ${how} INTO agent_sent (user, run, agent, started, ord, chat, turn, job, definition, name, tokens, chosen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [rows.user, s.run, s.agent, s.started, s.ord, s.chat, s.turn, s.job, s.definition, s.name, s.tokens, s.from]).changes;
  }
  return { calls, sent };
}

interface CallColumns {
  run: string;
  agent: string;
  n: number;
  started: number;
  ended: number;
  chat: string | null;
  turn: string | null;
  job: string | null;
  definition: string;
  plays: string | null;
  operation: string | null;
  purpose: string | null;
  model: string;
  connection: string;
  api: string | null;
  effort: string | null;
  since_last: number | null;
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  reasoning: number | null;
  parts: string | null;
  cache: string | null;
  stop: string;
  error: string | null;
}

function callOf(r: CallColumns): CallRow {
  return {
    run: r.run,
    agent: r.agent,
    n: r.n,
    started: r.started,
    ended: r.ended,
    chat: r.chat,
    turn: r.turn,
    job: r.job,
    definition: r.definition,
    plays: r.plays,
    operation: r.operation as AgentOperation | null,
    purpose: r.purpose,
    model: r.model,
    connection: r.connection,
    api: r.api,
    effort: r.effort as Effort | null,
    sinceLast: r.since_last,
    input: r.input,
    cacheRead: r.cache_read,
    cacheWrite: r.cache_write,
    output: r.output,
    reasoning: r.reasoning,
    parts: r.parts === null ? null : (JSON.parse(r.parts) as RequestPart[]),
    cache: r.cache === null ? null : (JSON.parse(r.cache) as CallCache),
    stop: r.stop,
    error: r.error,
  };
}

/** What a set of call rows `c` adds up to, as SQL: a call is counted long where it asked its provider's long lifetime. */
const SPENT = `count(*) AS calls, COALESCE(sum(c.input), 0) AS input, COALESCE(sum(c.cache_read), 0) AS cacheRead, COALESCE(sum(c.cache_write), 0) AS cacheWrite,
  COALESCE(sum(CASE WHEN json_extract(c.cache, '$.asked') = 'long' THEN c.cache_write ELSE 0 END), 0) AS cacheWriteLong, COALESCE(sum(c.output), 0) AS output, COALESCE(sum(c.reasoning), 0) AS reasoning`;

/** Tokens as counted, before any weight is put on them. */
type Counted = Omit<Spent, "weighted">;

/**
 * What tokens weigh, not rounded: those sent fresh count 1 each (RPH's `input` holds what was read from and written to the cache,
 * so they are what is left of it), and the rest by their weights.
 */
function weigh(of: Pick<Counted, "input" | "cacheRead" | "cacheWrite" | "cacheWriteLong" | "output">, by: Weights): number {
  const short = of.cacheWrite - of.cacheWriteLong;
  return of.input - of.cacheRead - of.cacheWrite + of.cacheRead * by.cacheRead + short * by.cacheWrite + of.cacheWriteLong * by.cacheWriteLong + of.output * by.output;
}

const nothingSpent = (): Spent => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0, output: 0, reasoning: 0, weighted: 0 });

/** Adds what calls on one connection counted to a sum, weighed by that connection's weights; the sum's weighted figure is rounded once it is whole (`whole`). */
function add(sum: Spent, counted: Counted, by: Weights): void {
  sum.calls += counted.calls;
  sum.input += counted.input;
  sum.cacheRead += counted.cacheRead;
  sum.cacheWrite += counted.cacheWrite;
  sum.cacheWriteLong += counted.cacheWriteLong;
  sum.output += counted.output;
  sum.reasoning += counted.reasoning;
  sum.weighted += weigh(counted, by);
}

const whole = (sum: Spent): Spent => ({ ...sum, weighted: Math.round(sum.weighted) });

/** One call's tokens as a sum counts them. */
const countedOf = (c: CallRow): Counted => ({ calls: 1, input: c.input, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite, cacheWriteLong: c.cache?.asked === "long" ? c.cacheWrite : 0, output: c.output, reasoning: c.reasoning ?? 0 });

/** What one call weighs, by its connection's weights. */
export function weighedCall(call: CallRow, weights: UsageWeights): number {
  return Math.round(weigh(countedOf(call), weightsOf(weights, call.connection)));
}

/** What these calls spent together, each weighed by its connection's weights. */
export function spentBy(calls: readonly CallRow[], weights: UsageWeights): Spent {
  const sum = nothingSpent();
  for (const c of calls) add(sum, countedOf(c), weightsOf(weights, c.connection));
  return whole(sum);
}

export class CallRows {
  readonly #live = new Followed();
  /** Rows queued and not yet written. */
  readonly #pending = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Database,
    private readonly writes: Writes,
    private readonly log: Log,
  ) {}

  /**
   * A record of RPH's trace, as it came. Never waits, and never fails the trace: the rows it completes are queued, and a row that
   * cannot be made or written is logged, its record going on to the live view and the turn's folder as every other does.
   */
  record(record: TraceRecord): void {
    const lost = (error: unknown): void => this.log.error("A model call's row could not be kept. Its run's kept trace still holds the call; Read them in adds it only where its turn or job has no row at all.", { run: record.run, error: error instanceof Error ? error.message : String(error) });
    try {
      const rows = this.#live.take(record);
      if (rows === null) return;
      const done = this.writes.run((into) => put(into, rows, "REPLACE"), "keeping a model call's row").catch(lost);
      this.#pending.add(done);
      void done.finally(() => this.#pending.delete(done));
    } catch (error) {
      lost(error);
    }
  }

  /** Resolves once every row queued so far is written, or logged as not kept. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  /** What is held now: the runs followed, and the rows not yet written. */
  held(): { runs: number; writes: number } {
    return { runs: this.#live.runs.size, writes: this.#pending.size };
  }

  /**
   * Reads kept records in, in the order RPH gave them (a turn folder's, or a job's own): the rows they complete are written where
   * none is kept yet, never over a row written as its call ran. How many rows it added, and how many of the calls added carry no
   * parts (a trace kept before RPH told them holds each call's totals alone).
   */
  async readIn(records: readonly TraceRecord[]): Promise<{ calls: number; sent: number; withoutParts: number }> {
    const followed = new Followed();
    const found = records.flatMap((record) => followed.take(record) ?? []);
    if (found.length === 0) return { calls: 0, sent: 0, withoutParts: 0 };
    return await this.writes.run((into) => {
      const added = { calls: 0, sent: 0, withoutParts: 0 };
      for (const rows of found) {
        // Call by call, so that each one added is known to carry parts or none.
        for (const call of rows.calls) {
          const wrote = put(into, { user: rows.user, calls: [call], sent: [] }, "IGNORE").calls;
          added.calls += wrote;
          if (call.parts === null) added.withoutParts += wrote;
        }
        added.sent += put(into, { user: rows.user, calls: [], sent: rows.sent }, "IGNORE").sent;
      }
      return added;
    }, "reading a kept trace in as rows of its model calls");
  }

  /** Removes the user's rows of calls that began before `before`, and of what agents started before it were handed. How many rows went. */
  async prune(user: string, before: number): Promise<number> {
    return await this.writes.run((into) => into.run("DELETE FROM call WHERE user = ? AND started < ?", [user, before]).changes + into.run("DELETE FROM agent_sent WHERE user = ? AND started < ?", [user, before]).changes, "removing old rows of model calls");
  }

  /** The calls recorded under any of these turns, each turn's runs' and its jobs' alike, in the order their requests went out. */
  ofTurns(user: string, turns: readonly string[]): CallRow[] {
    return this.db.query<CallColumns, [string, string]>("SELECT * FROM call WHERE user = ? AND turn IN (SELECT value FROM json_each(?)) ORDER BY started, n").all(user, JSON.stringify(turns)).map(callOf);
  }

  /** What the agents started under any of these turns were handed, in the order each was started and handed them. */
  sentOfTurns(user: string, turns: readonly string[]): SentRow[] {
    return this.db
      .query<Omit<SentRow, "from"> & { chosen: SentItem["from"] }, [string, string]>("SELECT run, agent, started, ord, chat, turn, job, definition, name, tokens, chosen FROM agent_sent WHERE user = ? AND turn IN (SELECT value FROM json_each(?)) ORDER BY started, ord")
      .all(user, JSON.stringify(turns))
      .map(({ chosen, ...row }) => ({ ...row, from: chosen }));
  }

  /** Whether a call of the turn's own runs is kept: one recorded under the turn by an agent of no job (a job's calls are its own run's). */
  hasOfTurn(user: string, turn: string): boolean {
    return this.db.query<{ n: number }, [string, string]>("SELECT EXISTS(SELECT 1 FROM call WHERE user = ? AND turn = ? AND job IS NULL) AS n").get(user, turn)?.n === 1;
  }

  /**
   * What the kept calls recorded under each of these turns weigh, not rounded: those of the turn's own runs together, and each of
   * its jobs' by the job's id. A turn none of whose calls is kept is not in the answer.
   */
  weighedOfTurns(user: string, turns: readonly string[], weights: UsageWeights): Map<string, { runs: number; jobs: Map<string, number> }> {
    const rows = this.db
      .query<Counted & { turn: string; job: string | null; connection: string }, [string, string]>(`SELECT c.turn AS turn, c.job AS job, c.connection AS connection, ${SPENT} FROM call c WHERE c.user = ? AND c.turn IN (SELECT value FROM json_each(?)) GROUP BY 1, 2, 3`)
      .all(user, JSON.stringify(turns));
    const by = new Map<string, { runs: number; jobs: Map<string, number> }>();
    for (const r of rows) {
      let of = by.get(r.turn);
      if (of === undefined) by.set(r.turn, (of = { runs: 0, jobs: new Map() }));
      const weighed = weigh(r, weightsOf(weights, r.connection));
      if (r.job === null) of.runs += weighed;
      else of.jobs.set(r.job, (of.jobs.get(r.job) ?? 0) + weighed);
    }
    return by;
  }

  /**
   * What the user's calls of a span spent: in all, and by the definition that made them, by what they were for, by the parts of
   * their requests, by chat (none for a job of no chat) and by the day each began, counted `offset` minutes east of UTC. Each sum
   * is added up connection by connection, so that each connection's calls are weighed by its own weights.
   */
  sums(user: string, of: CallsOf, offset: number, weights: UsageWeights): SpanSums {
    const where = ["c.user = ?"];
    const args: (string | number)[] = [user];
    if (of.chat !== undefined) {
      where.push("c.chat = ?");
      args.push(of.chat);
    }
    if (of.from !== undefined) {
      where.push("c.started >= ?");
      args.push(of.from);
    }
    if (of.to !== undefined) {
      where.push("c.started < ?");
      args.push(of.to);
    }
    if (of.turns !== undefined) {
      where.push("c.turn IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(of.turns));
    }
    const span = where.join(" AND ");
    /** The span's calls summed by `key`, the one that weighs most first; then the one that sent and wrote most, then by the key. */
    const by = (key: string, first: readonly (string | number)[] = []): { key: string | null; spent: Spent }[] => {
      const sums = new Map<string | null, Spent>();
      for (const r of this.db.query<Counted & { cut: string | null; connection: string }, (string | number)[]>(`SELECT ${key} AS cut, c.connection AS connection, ${SPENT} FROM call c WHERE ${span} GROUP BY 1, 2`).all(...first, ...args)) {
        let sum = sums.get(r.cut);
        if (sum === undefined) sums.set(r.cut, (sum = nothingSpent()));
        add(sum, r, weightsOf(weights, r.connection));
      }
      return [...sums]
        .map(([cut, sum]) => ({ key: cut, spent: whole(sum) }))
        .sort((a, b) => b.spent.weighted - a.spent.weighted || b.spent.input + b.spent.output - (a.spent.input + a.spent.output) || (a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : a.key < b.key ? -1 : 1));
    };
    const total = nothingSpent();
    let withParts = 0;
    for (const r of this.db.query<Counted & { connection: string; withParts: number | null }, (string | number)[]>(`SELECT c.connection AS connection, ${SPENT}, sum(c.parts IS NOT NULL) AS withParts FROM call c WHERE ${span} GROUP BY 1`).all(...args)) {
      add(total, r, weightsOf(weights, r.connection));
      withParts += r.withParts ?? 0;
    }
    const parts = this.db
      .query<{ part: RequestPartKind; name: string | null; calls: number; chars: number; tokens: number }, (string | number)[]>(
        `SELECT json_extract(p.value, '$.part') AS part, json_extract(p.value, '$.name') AS name, count(DISTINCT c.rowid) AS calls,
           COALESCE(sum(json_extract(p.value, '$.chars')), 0) AS chars, COALESCE(sum(json_extract(p.value, '$.tokens')), 0) AS tokens
         FROM call c, json_each(c.parts) p WHERE ${span} AND c.parts IS NOT NULL GROUP BY 1, 2 ORDER BY tokens DESC, 1, 2`,
      )
      .all(...args);
    return {
      total: whole(total),
      withParts,
      byDefinition: by("c.definition").map((r) => ({ definition: r.key ?? "", spent: r.spent })),
      byOperation: by("c.operation").map((r) => ({ operation: r.key as AgentOperation | null, spent: r.spent })),
      byPart: parts,
      byChat: by("c.chat").map((r) => ({ chat: r.key, spent: r.spent })),
      byDay: by("strftime('%Y-%m-%d', (c.started + ?) / 1000, 'unixepoch')", [offset * 60_000])
        .map((r) => ({ day: r.key ?? "", spent: r.spent }))
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    };
  }
}
