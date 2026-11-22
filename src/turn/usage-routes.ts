// What the models were used for, as the pages read it (plan §4 "RPE keeps and serves"), from the rows `usage.ts` keeps, each route
// declared in the route form so the pages' types and the API reference are written from it: one turn's use, agent by agent, each
// with what it was handed and its calls in order, each call with its request by part, and beside the turn the jobs its runs started,
// each with its own use; a span of his calls, of turns or of time, summed in all and by definition, by operation, by part, by chat
// and by day; and, on his press, the reading in of the turns and the jobs played before each call was kept as a row, from the traces
// their folders keep. Every route is a page's: it answers only for the user this RPE belongs to. A turn's use is read by the turns
// its runs played under (`playedUnder`), so a continue that joined a turn is counted with it; a job is tied to its turn through its
// own record. Nothing here adds a cached token twice: RPH's `input` already holds what was read from and written to the cache.

import type { Database } from "bun:sqlite";
import type { JobView, Log, RunScope, TraceRecord } from "rp-harness/contract";
import { agentOperation, callCache, effort, type Exactly, type Holds, type Infer, jobRow, requestPart, requestPartKind, route, RouteError, sentItem, shape } from "../app";
import type { ConfigRead } from "../app/config-read";
import { JoinedTurnError } from "../store";
import { jobRowOf, jobsOfTurns, jobsWithoutCalls } from "./jobs";
import { playedUnder, type Runs } from "./runs";
import { type CallRow, type CallRows, type SentRow, type Spent, spentBy } from "./usage";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const field = shape.field;
const nullable = shape.nullable;

const spent = shape.named(
  "CallsSpent",
  "What a set of model calls spent together: how many; the tokens sent, those read from the provider's cache and written to it among them; of those, the tokens read from the cache and the tokens written to it, and of the written ones those of the calls that asked the cache's long lifetime; the tokens the model wrote, its reasoning among them; and its reasoning, where the provider reported it. No figure adds a cached token twice: input already holds them.",
  shape.object({ calls: N, input: N, cacheRead: N, cacheWrite: N, cacheWriteLong: N, output: N, reasoning: N }),
);
type SpentMirrored = Holds<Exactly<Infer<typeof spent>, Spent>>;

const callShown = shape.named(
  "CallShown",
  "One model call as its row keeps it: what it was for, on what, when, its tokens, its request by part, and what it asked of the provider's cache.",
  shape.object({
    n: field(N, "Its number as its agent counted it, from 1; a save before a compaction counts from 1 again under the agent's own handle."),
    operation: field(nullable(agentOperation), "What it was for; null for a call kept before RPH named it."),
    purpose: field(nullable(T), "The purpose its agent was started for, where one was known."),
    model: T,
    connection: T,
    api: field(nullable(T), "The model layer's name for the API its connection's provider speaks."),
    effort: nullable(effort),
    started: field(N, "When its request went out, in milliseconds since 1970."),
    ended: field(N, "When its answer ended; for a call a stop or a limit cut off, when its agent ended."),
    sinceLast: field(nullable(N), "Milliseconds since its agent's last request ended; null on the agent's first."),
    input: field(N, "Tokens sent, those read from and written to the cache among them."),
    cacheRead: N,
    cacheWrite: N,
    output: field(N, "Tokens written, reasoning among them."),
    reasoning: nullable(N),
    parts: field(nullable(shape.list(requestPart)), "Its request by part; null for a call of a turn played before RPH told them, whose row carries its totals alone."),
    cache: field(nullable(callCache), "What it asked of its provider's cache and what came of it; null where its record gave none."),
    stop: field(T, "Why it stopped, in the provider's word; for a call a stop or a limit cut off, how its agent ended."),
    error: nullable(T),
  }),
);

const agentUse = shape.named(
  "AgentUse",
  "One agent of a run and what it used: what its calls add up to, what it was handed each time it was started, and its calls in the order their requests went out.",
  shape.object({
    run: field(T, "RPH's own id for the run it worked in; a job's run is the job's id."),
    agent: field(T, "Its handle."),
    definition: T,
    plays: field(nullable(T), "The character it plays; null for an agent that plays none."),
    spent,
    sent: field(shape.list(shape.object({ at: N, items: shape.list(sentItem) })), "What it was handed, each time it was started (its own work, a message that continues it): when, and each item with its size and who chose it. None for an agent of a turn played before RPH told them."),
    calls: shape.list(callShown),
  }),
);
type AgentUse = Infer<typeof agentUse>;

const jobUse = shape.named(
  "JobUse",
  "A job a turn's runs started and what it used: its row as a list of jobs shows it, with what it spent as RPH counts it (null where RPE no longer keeps its record), what the rows of its calls add up to, and its agents with their calls.",
  shape.object({ id: T, job: nullable(jobRow), spent, agents: shape.list(agentUse) }),
);

export const turnUseReply = shape.named(
  "TurnUseReply",
  "Where a turn's tokens went: what the calls of its own runs add up to, the agents of its runs with what each was handed and its calls, and the jobs its runs started, each with its own use.",
  shape.object({
    turn: shape.turnId(),
    spent: field(spent, "What the calls of its own runs add up to; its jobs' calls are not among them."),
    agents: field(shape.list(agentUse), "The agents of its runs, in the order each first worked."),
    jobs: field(shape.list(jobUse), "The jobs its runs started, the first started first."),
  }),
);

export const usageReply = shape.named(
  "UsageReply",
  "What a span of his model calls spent: in all, and by the definition that made them, by what they were for, by the parts of their requests, by chat and by day.",
  shape.object({
    from: field(nullable(N), "Where the span begins, in milliseconds since 1970: as asked, or for a span of turns when the oldest of its turns was received (ask the span before it with this as `to`); null for one that names no beginning, or holds no turn."),
    to: field(nullable(N), "Where the span ends, as asked; null for one that runs to now."),
    turns: field(nullable(N), "For a span of turns: how many turns it holds, fewer than asked where no more were played; null for a span of time."),
    total: spent,
    withParts: field(N, "How many of its calls carry their request by part: the sums by part are of those alone. A call of a turn read in from a trace kept before RPH told the parts carries none."),
    byDefinition: field(shape.list(shape.object({ definition: T, spent })), "By the agent definition that made the calls, the one that used most first."),
    byOperation: field(shape.list(shape.object({ operation: nullable(agentOperation), spent })), "By what the calls were for, the operation that used most first; null gathers the calls kept before RPH named it."),
    byPart: field(
      shape.list(shape.object({ part: requestPartKind, name: nullable(T), calls: N, chars: N, tokens: N })),
      "By the part of the requests, and its name where it has one, the largest first: the calls that carried it, and its characters and its tokens by RPH's own estimate, added up over them.",
    ),
    byChat: field(shape.list(shape.object({ chat: nullable(T), spent })), "By chat, the one that used most first; null gathers the jobs of no chat."),
    byDay: field(shape.list(shape.object({ day: T, spent })), "By the day each call began, as YYYY-MM-DD, the earliest first, counted in the offset asked."),
  }),
);

export const readInReply = shape.named(
  "UsageReadInReply",
  "What a reading in of past use found: the turn folders and the jobs' own traces it read, those it could not read, the rows of model calls and of items handed it added, and how many of the calls added carry no parts (their totals alone: a trace kept before RPH told a request by part holds no more).",
  shape.object({ turns: N, jobs: N, unread: N, calls: N, sent: N, withoutParts: N }),
);

export interface UsageRoutesDeps {
  /** The rows of the model calls. */
  calls: CallRows;
  /** Each turn's runs as kept. */
  runs: Pick<Runs, "ofTurn" | "running" | "newestPlayed" | "playedFolders">;
  /** RPE's database, read at any time: the jobs' own records. */
  db: Database;
  /** A turn as the store holds it: its chat and the turn it was joined to; null where the store holds none by the id. */
  turn(user: string, turn: string): { chat: string; joined: string | null } | null;
  /** The records a scope's folder keeps, without what the transcripts hold (`TurnTrace.kept`). */
  kept(scope: RunScope): Promise<TraceRecord[]>;
  /** The levels every chat shares, read now: how much of a job's brief its row shows. */
  shared(): ConfigRead;
  log: Log;
}

/** The agents among these rows, in the order each first worked or was handed something, each with what it was handed and its calls. */
function agentsOf(calls: readonly CallRow[], sent: readonly SentRow[]): AgentUse[] {
  const agents = new Map<string, { first: number; use: AgentUse; rows: CallRow[] }>();
  const of = (row: Pick<CallRow, "run" | "agent" | "definition">, at: number, plays: string | null) => {
    const key = `${row.run}\u0000${row.agent}`;
    let held = agents.get(key);
    if (held === undefined) agents.set(key, (held = { first: at, use: { run: row.run, agent: row.agent, definition: row.definition, plays, spent: spentBy([]), sent: [], calls: [] }, rows: [] }));
    held.first = Math.min(held.first, at);
    return held;
  };
  for (const s of sent) {
    const { use } = of(s, s.started, null);
    const last = use.sent.at(-1);
    const item = { name: s.name, tokens: s.tokens, from: s.from };
    if (last !== undefined && last.at === s.started) last.items.push(item);
    else use.sent.push({ at: s.started, items: [item] });
  }
  for (const c of calls) {
    const held = of(c, c.started, c.plays);
    held.use.plays ??= c.plays;
    held.rows.push(c);
    held.use.calls.push({ n: c.n, operation: c.operation, purpose: c.purpose, model: c.model, connection: c.connection, api: c.api, effort: c.effort, started: c.started, ended: c.ended, sinceLast: c.sinceLast, input: c.input, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite, output: c.output, reasoning: c.reasoning, parts: c.parts, cache: c.cache, stop: c.stop, error: c.error });
  }
  return [...agents.values()].sort((a, b) => a.first - b.first).map(({ use, rows }) => ({ ...use, spent: spentBy(rows) }));
}

export function usageRoutes(deps: UsageRoutesDeps) {
  const { calls, runs } = deps;

  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/use",
      access: "page",
      group: "turns",
      does: "Where a turn's tokens went: the agents of its runs, each with what it was handed and its model calls in order (what each was for, its tokens, its request by part, what it asked of the provider's cache), and the jobs its runs started, each with its own use. The rows stay when the turn is swiped away.",
      reply: turnUseReply,
      joined: true,
      handle: async ({ user, params }) => {
        const row = deps.turn(user, params.turn);
        if (row !== null && row.chat === params.chat && row.joined !== null) throw new JoinedTurnError(params.turn, row.joined);
        const ofTurn = runs.ofTurn(user, params.turn).filter((r) => r.chat === params.chat);
        if (ofTurn.length === 0) throw new RouteError(404, `Chat ${params.chat} has no turn ${params.turn}.`);
        // A call that ended a moment ago has its row queued: the read waits for it.
        await calls.settled();
        const under = playedUnder(params.turn, ofTurn);
        const rows = calls.ofTurns(user, under);
        const sent = calls.sentOfTurns(user, under);
        const own = rows.filter((c) => c.job === null);
        // Its jobs by their own records, the first started first, then any whose record RPE no longer keeps and whose calls it does.
        const records = new Map<string, JobView>(jobsOfTurns(deps.db, user, under).map((job) => [job.id, job]));
        const ids = [...new Set([...records.keys(), ...rows.flatMap((c) => (c.job === null ? [] : [c.job])), ...sent.flatMap((s) => (s.job === null ? [] : [s.job]))])];
        const shared = deps.shared();
        return {
          turn: params.turn,
          spent: spentBy(own),
          agents: agentsOf(
            own,
            sent.filter((s) => s.job === null),
          ),
          jobs: ids.map((id) => {
            const of = rows.filter((c) => c.job === id);
            const record = records.get(id);
            return {
              id,
              job: record === undefined ? null : jobRowOf(record, shared),
              spent: spentBy(of),
              agents: agentsOf(
                of,
                sent.filter((s) => s.job === id),
              ),
            };
          }),
        };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/usage",
      access: "page",
      group: "turns",
      does: "What a span of his model calls spent, in all and by definition, by operation, by part, by chat and by day: the calls of his newest turns (`turns`), their jobs' among them, or the calls that began in a stretch of time (`from`, `to`), of one chat or of every chat and of none.",
      query: {
        chat: opt(T, "Only this chat's: its turns, for a span of turns; its calls, for a span of time. Left out: every chat's, and the calls of jobs of no chat."),
        turns: opt(shape.whole({ least: 1 }), "A span of turns: the calls of this many of the newest turns he played, each turn's runs' and its jobs' alike, among the turns received at or after `from` and before `to` where those are given."),
        from: opt(shape.whole({ least: 0 }), "In milliseconds since 1970: for a span of time, only the calls that began at or after it; for a span of turns, only the turns received at or after it."),
        to: opt(shape.whole({ least: 0 }), "In milliseconds since 1970: for a span of time, only the calls that began before it; for a span of turns, only the turns received before it."),
        offset: opt(N, "For the sums by day: the minutes east of UTC the days are counted in, as the page's own clock stands; 0, UTC, when left out."),
      },
      reply: usageReply,
      handle: async ({ user, query }) => {
        await calls.settled();
        const offset = Math.round(query.offset ?? 0);
        const { chat, from, to } = query;
        if (query.turns !== undefined) {
          const played = runs.newestPlayed(user, query.turns, { ...(chat !== undefined ? { chat } : {}), ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) });
          const sums = calls.sums(user, { turns: played.flatMap((p) => p.under) }, offset);
          return { from: played.at(-1)?.received ?? null, to: to ?? null, turns: played.length, ...sums };
        }
        const sums = calls.sums(user, { ...(chat !== undefined ? { chat } : {}), ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }, offset);
        return { from: from ?? null, to: to ?? null, turns: null, ...sums };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/usage/read-in",
      access: "page",
      group: "turns",
      does: "On his press, reads in what was played before each model call was kept as a row: every turn folder of his whose runs have no row yet, and the own trace of every job that ended with none, each read from the trace it keeps, and each call found added with its totals. A trace kept before RPH told a request by part gives no parts, and the answer says how many calls were added without them. A row kept as its call ran is never written over, and a turn or a job going on now is left to its own records.",
      reply: readInReply,
      long: true,
      handle: async ({ user }) => {
        const read = { turns: 0, jobs: 0, unread: 0, calls: 0, sent: 0, withoutParts: 0 };
        /** Reads one kept trace in; one that cannot be read is counted and logged, and the next press tries it again. */
        const take = async (what: "turns" | "jobs", of: Record<string, string>, records: () => Promise<TraceRecord[]>): Promise<void> => {
          try {
            const added = await calls.readIn(await records());
            read[what]++;
            read.calls += added.calls;
            read.sent += added.sent;
            read.withoutParts += added.withoutParts;
          } catch (error) {
            read.unread++;
            deps.log.error("A kept trace could not be read in as rows of its model calls; the next reading in tries it again.", { ...of, error: error instanceof Error ? error.message : String(error) });
          }
        };
        // The turns' own runs, each in the folder it played in.
        for (const folder of runs.playedFolders(user)) {
          if (runs.running(user, folder.turn) !== undefined || calls.hasOfTurn(user, folder.turn)) continue;
          await take("turns", { chat: folder.chat, turn: folder.turn }, () => deps.kept({ user, chat: folder.chat, session: folder.session, turn: folder.turn }));
        }
        // The jobs, each under its own session: its run's records are those that name it.
        for (const job of jobsWithoutCalls(deps.db, user)) await take("jobs", { job: job.id }, async () => (await deps.kept(job.scope)).filter((record) => record.run === job.id));
        return read;
      },
    }),
  ] as const;
}

export type Mirrors = [SpentMirrored];
