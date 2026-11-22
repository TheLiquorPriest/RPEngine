// What the tests of the use of the models share (`usage.test.ts`, `usage-routes.test.ts`, the pages' `test/ui/usage-page.test.ts`):
// RPE's database with the store's and the harness's tables, its write queue, the rows of the model calls over them, the weights of
// the weighted figure as shipped and as a config file sets them, and a turn as RPH's trace tells it: the Author's two calls with
// their parts, the GM it started, and a job's agent under the job's own run. Every name and every figure is invented.

import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRef, JobView, JsonValue, Log, RunScope, Scope, TraceEvent, TraceRecord, Usage } from "rp-harness/contract";
import { readConfig } from "../../src/app/config-read";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import type { ApiRoutes } from "../../src/shared/api";
import { STORE_MIGRATIONS } from "../../src/store";
import { HARNESS_MIGRATIONS } from "../../src/turn";
import { type Run, type RunRecord, Runs } from "../../src/turn/runs";
import { usageWeights } from "../../src/turn/settings";
import { CallRows, type UsageWeights } from "../../src/turn/usage";
import { usageRoutes } from "../../src/turn/usage-routes";
import { callRoute } from "../app/call";

/** The global level's config file with `text` in it, as the weights' reader reads it; no text: every setting at its shipped value. */
export const globalRead = (text = "") => readConfig([{ level: "global", file: "RPE-global.yml", text }], null);

/** The weights as shipped (a token read from the cache 0.1, written to it 1.25 and 2 for its long lifetime, written out 5), or as `text` sets them at the global level for the connections given. */
export const weightsOf = (text = "", connections: readonly { id: string; name: string }[] = []): UsageWeights => usageWeights(globalRead(text), connections);
export const SHIPPED: UsageWeights = weightsOf();

export const USER = "user-ines";
export const CHAT = "chat-saltmarsh";
export const SESSION = "session-quay";
export const TURN = "turn-ferry";
export const RUN = "run-ferry";
export const JOB = "job-tide-tables";
export const SCOPE: Scope = { user: USER, chat: CHAT, session: SESSION, turn: TURN };
export const AUTHOR: AgentRef = { id: "agent-author", definition: "author" };
export const GM: AgentRef = { id: "agent-gm", definition: "gm", parent: AUTHOR.id };
export const T0 = Date.UTC(2031, 2, 9, 20, 0, 0);

/** One call's tokens as RPH counts them: sent (what was read from and written to the cache among it), read from the cache, written to it, written by the model, and its reasoning. */
export const spent = (input: number, cacheRead: number, cacheWrite: number, output: number, reasoning?: number): Usage => ({ calls: 1, input, cacheRead, cacheWrite, output, ...(reasoning !== undefined ? { reasoning } : {}) });
export const sum = (...of: Usage[]): Usage => of.reduce((a, b) => ({ calls: a.calls + b.calls, input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output }), { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });

/** Records as RPH numbers them within a run, each a given time after `from`. */
export function recorder(run: string, scope: RunScope = SCOPE, from = T0) {
  let seq = 0;
  return (agent: AgentRef, after: number, event: TraceEvent): TraceRecord => ({ seq: ++seq, run, scope, at: from + after, agent, event });
}

export const started = (definition: string, more: Partial<Extract<TraceEvent, { kind: "agent_started" }>> = {}): TraceEvent => ({ kind: "agent_started", definition, connection: "conn-harbor", model: "model-gull", effort: "high", session: SESSION, given: [], api: "harbor-messages", ...more });
export const calling = (call: number, more: Partial<Extract<TraceEvent, { kind: "call_started" }>> = {}): TraceEvent => ({ kind: "call_started", call, connection: "conn-harbor", model: "model-gull", messages: 3, tools: 2, ...more });
export const answered = (call: number, usage: Usage, ms: number, more: Partial<Extract<TraceEvent, { kind: "call_ended" }>> = {}): TraceEvent => ({ kind: "call_ended", call, model: "model-gull", text: "", toolCalls: [], stop: "stop", usage, ms, ...more });
export const ended = (usage: Usage, status: "done" | "stopped" = "done"): TraceEvent => ({ kind: "agent_ended", status, usage });

export const LEAD_1 = spent(9_000, 0, 8_200, 300, 120);
export const LEAD_2 = spent(9_800, 8_200, 900, 450);
export const GM_1 = spent(4_000, 0, 0, 600);
export const CLERK_1 = spent(2_500, 0, 0, 800);

/** Where a job a turn started runs: the turn's chat and turn, in a session of the job's own, whose folder keeps its records apart from the turn's. */
export const jobScope = (job: string, turn: string = TURN): Scope => ({ user: USER, chat: CHAT, session: `session-${job}`, turn });

/** A job a turn's Author started, `at` milliseconds after `T0`, as RPH keeps its record once it has ended. */
export const jobRecord = (id: string = JOB, turn: string = TURN, at = 0): JobView => ({ id, agent: "historian", brief: "Tally the tide tables.", state: "done", scope: jobScope(id, turn), startedBy: AUTHOR, started: T0 + at + 6_100, ended: T0 + at + 9_612, usage: CLERK_1 });

/**
 * A turn as RPH tells it, `at` milliseconds after `T0`, in the order its records come: the Author's two calls with their parts, the GM
 * it started, and the agent of a job the Author started, under the job's own run and session, which ends after the turn's run does.
 */
export function turnRecords(of: { turn?: string; run?: string; job?: string; at?: number } = {}): TraceRecord[] {
  const scope: Scope = { ...SCOPE, turn: of.turn ?? TURN };
  const id = of.job ?? JOB;
  const clerk: AgentRef = { id: "agent-clerk", definition: "historian", job: id };
  const turn = recorder(of.run ?? RUN, scope, T0 + (of.at ?? 0));
  const job = recorder(id, jobScope(id, scope.turn), T0 + (of.at ?? 0));
  return [
    turn(AUTHOR, 0, { kind: "run_started", run: "turn", turn: "new", lead: "author" }),
    turn(AUTHOR, 1, started("author", { operation: "lead", given: ["briefing", "prompt:*"], sent: [{ name: "briefing", tokens: 1_900, from: "definition" }, { name: "prompt:*", tokens: 5_200, from: "definition" }] })),
    turn(AUTHOR, 10, calling(1, { parts: [{ part: "opening", chars: 6_000, tokens: 1_500 }, { part: "prompt", name: "lore", chars: 8_000, tokens: 2_000 }, { part: "briefing", name: "world-state", chars: 7_600, tokens: 1_900 }] })),
    turn(AUTHOR, 4_010, answered(1, LEAD_1, 4_000, { stop: "toolUse", cache: { asked: "long", marks: [{ at: "system", index: 0, lifetime: "long" }] } })),
    turn(GM, 4_020, started("gm", { operation: "sub", for: "Can the ferry cross tonight?", sent: [{ name: "world:scene(full, map)", tokens: 2_100, from: "definition" }, { name: "story:brief", tokens: 400, from: "caller" }] })),
    turn(GM, 4_030, calling(1, { parts: [{ part: "opening", chars: 4_000, tokens: 1_000 }, { part: "given", name: "story:brief", chars: 1_600, tokens: 400 }, { part: "brief", chars: 120, tokens: 30 }] })),
    turn(GM, 6_030, answered(1, GM_1, 2_000, { cache: { asked: "short" } })),
    turn(GM, 6_031, ended(GM_1)),
    job(clerk, 6_100, { kind: "run_started", run: "job", lead: "historian" }),
    job(clerk, 6_101, started("historian", { operation: "job", for: "historian" })),
    job(clerk, 6_110, calling(1, { parts: [{ part: "opening", chars: 3_200, tokens: 800 }, { part: "brief", chars: 400, tokens: 100 }] })),
    turn(AUTHOR, 6_200, calling(2, { sinceLast: 2_190, parts: [{ part: "opening", chars: 6_000, tokens: 1_500 }, { part: "results", name: "delegate", chars: 2_400, tokens: 600 }, { part: "prompt", name: "lore", chars: 8_000, tokens: 2_000 }] })),
    turn(AUTHOR, 9_200, answered(2, LEAD_2, 3_000, { cache: { asked: "long", cold: true, cause: "changed" } })),
    turn(AUTHOR, 9_201, ended(sum(LEAD_1, LEAD_2))),
    turn(AUTHOR, 9_202, { kind: "run_ended", outcome: { status: "released", released: true, usage: sum(LEAD_1, LEAD_2, GM_1) } }),
    job(clerk, 9_610, answered(1, CLERK_1, 3_500, { cache: { asked: "none" } })),
    job(clerk, 9_611, ended(CLERK_1)),
    job(clerk, 9_612, { kind: "job", job: jobRecord(id, scope.turn, of.at ?? 0) }),
  ];
}

/** The same records as a build before RPH told the use of the models kept them: no operation, nothing handed, no parts, no word of the cache. */
export function before(records: readonly TraceRecord[]): TraceRecord[] {
  return records.map((record): TraceRecord => {
    const { event } = record;
    if (event.kind === "agent_started") {
      const { operation: _operation, for: _for, sent: _sent, api: _api, ...old } = event;
      return { ...record, event: old };
    }
    if (event.kind === "call_started") {
      const { parts: _parts, sinceLast: _sinceLast, ...old } = event;
      return { ...record, event: old };
    }
    if (event.kind === "call_ended") {
      const { cache: _cache, ...old } = event;
      return { ...record, event: old };
    }
    return record;
  });
}

export interface UsageBed {
  db: Database;
  writes: WriteQueue;
  calls: CallRows;
  /** RPE's log: every line, at any level. */
  log: Log;
  logged: { message: string; fields?: Record<string, JsonValue> }[];
  close(): Promise<void>;
}

/** RPE's database brought up with the store's and the harness's tables, its write queue, and the rows of the model calls over them. */
export async function usageBed(): Promise<UsageBed> {
  const place = await mkdtemp(join(tmpdir(), "rpe-usage-"));
  const db = openDatabase(join(place, "rpe.db"), 2_000);
  // The harness's tables, which stand on the store's.
  const migrations = new Migrations();
  migrations.add("store", STORE_MIGRATIONS);
  migrations.add("harness", HARNESS_MIGRATIONS);
  migrate(db, migrations, { user: USER, version: "usage-test", backups: join(place, "backups"), now: () => 0 });
  const writes = new WriteQueue(db, 50);
  const logged: UsageBed["logged"] = [];
  const line = (message: string, fields?: Record<string, JsonValue>) => void logged.push({ message, ...(fields !== undefined ? { fields } : {}) });
  const log: Log = { debug: line, info: line, warn: line, error: line };
  return {
    db,
    writes,
    calls: new CallRows(db, writes, log),
    log,
    logged,
    async close() {
      await writes.close();
      db.close();
      await rm(place, { recursive: true, force: true });
    },
  };
}

type TurnUse = ApiRoutes["GET /api/v1/chats/:chat/turns/:turn/use"]["reply"];
type UsageSpan = ApiRoutes["GET /api/v1/usage"]["reply"];
type ReadIn = ApiRoutes["POST /api/v1/usage/read-in"]["reply"];

/** A folder RPE keeps a trace in, by its place below the chat: the session, then the turn. */
const folderOf = (scope: RunScope): string => `${scope.session}/${scope.turn ?? ""}`;

/** The routes of the use of the models over a bed, called as the server calls them, with what stands behind them in the test's hands. */
export interface UsagePages {
  b: UsageBed;
  /** What each folder keeps, by folder; a folder in `unreadable` cannot be read, and each read is noted in `read`. */
  kept: Map<string, TraceRecord[]>;
  unreadable: Set<string>;
  read: string[];
  /** The turns with a run going on now. */
  going: Set<string>;
  /** The turns the store holds as joined to another, each with the turn it joined. */
  joined: Map<string, string>;
  /** The global level's config file as the routes read it at each call: the weights of the weighted figure, and how long the rows are kept. */
  config: { text: string };
  /** His connections as the model layer lists them: a connection's own weights set under its id are found by its name through them. */
  connections: { id: string; name: string }[];
  /** Keeps records as RPE's trace does: each in the folder of its scope's session and turn. */
  keeps(records: readonly TraceRecord[]): void;
  /** Keeps a run of RPE's as it stands. */
  played(run: Partial<RunRecord> & Pick<RunRecord, "id" | "turn" | "received">): Promise<void>;
  use(turn: string, chat?: string, user?: string): Promise<TurnUse>;
  span(query?: Record<string, string | number>, user?: string): Promise<UsageSpan>;
  readIn(): Promise<ReadIn>;
}

/** The routes over a new bed; the caller closes its bed (`b.close()`). */
export async function usagePages(): Promise<UsagePages> {
  const b = await usageBed();
  const runs = new Runs(b.db, b.writes);
  const kept = new Map<string, TraceRecord[]>();
  const unreadable = new Set<string>();
  const read: string[] = [];
  const going = new Set<string>();
  const joined = new Map<string, string>();
  const config = { text: "" };
  const connections: UsagePages["connections"] = [];
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
    shared: () => globalRead(config.text),
    weights: async () => weightsOf(config.text, connections),
    log: b.log,
  });
  return {
    b,
    kept,
    unreadable,
    read,
    going,
    joined,
    config,
    connections,
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
}
