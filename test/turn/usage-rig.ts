// What the tests of the use of the models share (`usage.test.ts`, `usage-routes.test.ts`): RPE's database with the store's and the
// harness's tables, its write queue, the rows of the model calls over them, and a turn as RPH's trace tells it: the Author's two
// calls with their parts, the GM it started, and a job's agent under the job's own run. Every name and every figure is invented.

import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRef, JobView, JsonValue, Log, RunScope, Scope, TraceEvent, TraceRecord, Usage } from "rp-harness/contract";
import { openDatabase, WriteQueue } from "../../src/app/database";
import { migrate, Migrations } from "../../src/app/migrations";
import { STORE_MIGRATIONS } from "../../src/store";
import { HARNESS_MIGRATIONS } from "../../src/turn";
import { CallRows } from "../../src/turn/usage";

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
