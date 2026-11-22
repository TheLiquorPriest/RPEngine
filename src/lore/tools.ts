// The lore's tools as the host hands them to RPH (plan §6.8, Appendix A `ToolsPort`), the batch an
// indexing run is given by name (`index:batch`, the indexer's `given:`), a job's plan and its numbered
// batches (`index:plan`, `index:batch(n)`, plan 3.2 §7.5), and the lore a character's agent is given as
// its own (`index:known-to-self`, the character's `given:`). As with the engine's and the story's tools,
// code holds a tool's name, family, tier, lane and the shape of its arguments; its description and each
// argument's text are its file in `.tools/`, and every sentence of an answer is a line of
// `.prompts/lore-answers.md`. An answer is data plus those lines. The lore may not reach the engine's
// tool kit, so it reads the files through RPH's guidance and makes its answers here, in the kit's
// shape: data as JSON, then lines.
//
// `lore_index_write` keeps an indexing run's lines and answers with the next batch, so one run goes
// on batch after batch for as long as its own limits let it; a job that has a plan is answered with
// what is left outside it, since its numbered batches hand out the rest. What a run is asked to do is
// its definition's (`.agents/indexer.md`); nothing here starts one.

import type { Fields, Guidance, LinesPart } from "../app/guidance";
import type { AgentRef, HostTool, JsonObject, JsonSchema, JsonValue, Log, ToolContent, ToolCtx, ToolResult } from "rp-harness/contract";
import { JoinedTurnError, type Lane } from "../store";
import type { IndexedEntry, LoreBinding, LoreIndex, LoreIndexInput, LoreNamedFields, LorePlan } from "./indexing";
import type { HeldSecret } from "./secrets/character";
import type { LoreAt } from "./lore";

/** The prompt part every lore answer, the batch, the readable index and the lore map's lines are worded by. */
export const LORE_ANSWERS = "lore-answers";

/** The name an agent is given the next batch by: a host's name, since RPH reads every `lore:` name as a lore entry. */
export const LORE_BATCH = "index:batch";

/** The name a job's agent is given its plan by (plan 3.2 §7.5): the chat's lore not indexed, cut into numbered batches, each with its size. */
export const LORE_PLAN = "index:plan";

/** A batch of a job's plan by its number (`index:batch(2)`): what an instance the job's agent starts is handed as its one batch. */
const NUMBERED = /^index:batch\(\s*(\d+)\s*\)$/;

/** The number a name opens a batch of the plan by (`index:batch(2)` is 2); undefined for any other name, the next batch's among them. */
export function loreBatchNumber(ref: string): number | undefined {
  const n = NUMBERED.exec(ref)?.[1];
  return n === undefined ? undefined : Number(n);
}

/** The name a character's agent is given the lore its character knows by: a host's name, for the same reason. */
export const LORE_KNOWN = "index:known-to-self";

/**
 * The lane `lore_index_write` writes to, so the user's Auto / Confirm / Never for it applies: the story lane, one of the two the
 * store has (`src/store/types.ts`). The lore has no lane of its own.
 */
export const LORE_LANE: Lane = "story";

/** The family `lore_index_write` is in, apart from the `lore` family the Author finds by search, so a definition can keep it out of reach whole (`out_of_reach:`). */
export const LORE_INDEX_FAMILY = "lore-index";

/**
 * A reason a lore tool cannot do what it was asked, which its caller can act on: answered as a refusal, in the words of the line of
 * `.prompts/lore-answers.md` it names. Any other throw is a fault of RPE's own.
 */
export class LoreRefusal extends Error {
  constructor(
    readonly line: string,
    readonly fields: Fields = {},
  ) {
    super(line);
  }
}

/** The answers' lines in force for the chat; undefined when the part is off, so every answer is given with no words. */
export async function loreLines(guidance: Guidance): Promise<LinesPart | undefined> {
  const part = await guidance.part(LORE_ANSWERS);
  return part?.format === "lines" ? part : undefined;
}

/** One line of the answers' part, filled; undefined when the part has no such line, or fills it with nothing. */
export function loreLine(lines: LinesPart | undefined, name: string, fields: Fields = {}): string | undefined {
  const text = lines?.line(name, fields);
  return text === undefined || text.trim() === "" ? undefined : text;
}

/** A binding as the lines show it. */
function bindingText(lines: LinesPart | undefined, b: LoreBinding): string {
  return loreLine(lines, "binding", { what: b.what, aspect: b.aspect }) ?? b.what;
}

/**
 * A list as a field the lines read: put in whole, joined, and a block on it shown once when it has
 * anything in it, rather than once for each item (the templates' own value under ".").
 */
export function listField(list: readonly string[]): { ".": string[] } {
  return { ".": [...list] };
}

/** The names an entry's own lines go by in every line of the index and the batch: a field of the indexer's file cannot take one of them. */
const ENTRY_NAMES = ["id", "title", "source", "keys", "size", "activation", "kind", "line", "defines", "related", "indexed", "stale", "revision", "text", "extras", "fields", "how", "notes", "bound"] as const;

/** Whether a field of the indexer's file can be named so: a name the lines can read, and not one the entry's own lines go by. */
export function isFieldName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !(ENTRY_NAMES as readonly string[]).includes(name);
}

/**
 * The named fields of an index line, as the lines read them: each by its own name (a list as a list), and all of them in
 * `extras` as "name: value", so one line can carry every field the indexer's file has added (plan D.2) without naming each.
 */
export function namedFields(fields: LoreNamedFields | undefined): Fields {
  const named = Object.entries(fields ?? {}).filter(([name]) => isFieldName(name));
  const texts = named.map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
  return { ...Object.fromEntries(named.map(([name, value]) => [name, Array.isArray(value) ? listField(value) : value])), ...(texts.length > 0 ? { extras: listField(texts) } : {}) };
}

/** An entry's fields as every line of the index and the batch reads them. */
export function entryFields(lines: LinesPart | undefined, e: IndexedEntry): Fields {
  return {
    ...namedFields(e.fields),
    id: e.id,
    title: e.title,
    source: e.source,
    keys: listField(e.keys),
    size: e.size,
    activation: listField(e.activation),
    kind: e.kind,
    line: e.line,
    defines: listField(e.defines.map((b) => bindingText(lines, b))),
    related: listField(e.related),
    indexed: e.indexed,
    stale: e.stale,
    revision: e.revision,
  };
}

/** Each entry's lines and its text, as a batch lays them out; an entry the part has no line for is not shown. */
function entryBlocks(lines: LinesPart | undefined, entries: readonly IndexedEntry[]): string[] {
  return entries.flatMap((e) => {
    const fields = { ...entryFields(lines, e), text: e.text };
    const parts = ["batch_entry", "batch_text"].flatMap((name) => loreLine(lines, name, fields) ?? []);
    return parts.length > 0 ? [parts.join("\n")] : [];
  });
}

/**
 * The next batch, as an indexing run is given it: a head line counting it and what is left, then each
 * entry's lines and its text. A line the part does not have is not shown; with nothing left, the part's
 * line that says so, or, where another job holds the rest, the line that says that; and where the rest
 * is the job's own plan's, handed out by number, the line that says that, or nothing (never "all indexed").
 */
export function batchText(lines: LinesPart | undefined, batch: { entries: readonly IndexedEntry[]; left: number; held?: number; planned?: number }): string {
  const held = batch.held ?? 0;
  const planned = batch.planned ?? 0;
  if (batch.entries.length === 0) {
    if (planned > 0) return loreLine(lines, "batch_planned", { planned, held }) ?? "";
    return (held > 0 ? loreLine(lines, "batch_held", { held }) : undefined) ?? loreLine(lines, "batch_none") ?? "";
  }
  const head = loreLine(lines, "batch_head", { count: batch.entries.length, left: batch.left, held, planned });
  return [...(head === undefined ? [] : [head]), ...entryBlocks(lines, batch.entries)].join("\n\n");
}

/** What a block says of a view that cannot be read (no Lumiverse set up, a book that fails): the part's line for it, with the reason. */
async function unreadable(guidance: Guidance, error: unknown): Promise<string> {
  const reason = error instanceof Error ? error.message : String(error);
  return loreLine(await loreLines(guidance), "batch_unreadable", { reason }) ?? reason;
}

/**
 * The `index:batch` block for a scope: the next batch of the chat's lore, worded by the lines in force, held for the job the agent
 * runs in. A batch that cannot be read (no Lumiverse set up, a book that fails) is told to the run in the part's line for it,
 * with the reason, so the run is never given an empty block it takes for "all indexed".
 */
export async function loreBatchBlock(index: LoreIndex, at: LoreAt, guidance: Guidance, agent?: AgentRef): Promise<string> {
  try {
    return batchText(await loreLines(guidance), await index.batch(at, undefined, agent?.job));
  } catch (error) {
    return await unreadable(guidance, error);
  }
}

/**
 * A plan as the lines word it: a head line, then a line for each batch with its number, the entries it was cut with, those left to
 * index in it and their size in tokens as opening it hands them (`tokens`, as the chat counts them), and those indexed since, gone
 * from the lore or held by another job; the part's line that says there is nothing to plan, when there is not. A batch the part has
 * no line for is given as its numbers, so the plan is never handed short.
 */
function planText(lines: LinesPart | undefined, plan: LorePlan, tokens: (text: string) => number): string {
  if (plan.batches.length === 0) return loreLine(lines, "plan_none", { held: plan.held }) ?? "";
  const rows = plan.batches.map((b) => {
    const fields = { n: b.n, count: b.count, left: b.entries.length, tokens: b.entries.length === 0 ? 0 : tokens(entryBlocks(lines, b.entries).join("\n\n")), indexed: b.indexed, gone: b.gone, held: b.held, done: b.entries.length === 0 && b.held === 0 };
    return loreLine(lines, "plan_batch", fields) ?? JSON.stringify(fields);
  });
  const head = loreLine(lines, "plan_head", { batches: plan.batches.length, left: plan.batches.filter((b) => b.entries.length > 0).length, held: plan.held });
  return [...(head === undefined ? [] : [head]), ...rows].join("\n");
}

/**
 * The `index:plan` block: the job's list of the chat's lore not indexed, cut into numbered batches when the job first asked and kept
 * with it (`LoreIndex.plan`), worded by the lines in force. Without a job (a preview, an agent no job started) it is cut for the
 * asking and held for no one.
 */
export async function lorePlanBlock(index: LoreIndex, at: LoreAt, guidance: Guidance, tokens: (text: string) => number, agent?: AgentRef): Promise<string> {
  try {
    return planText(await loreLines(guidance), await index.plan(at, agent?.job), tokens);
  } catch (error) {
    return await unreadable(guidance, error);
  }
}

/**
 * The `index:batch(n)` block: batch `n` of the job's plan as its entries stand now, a head line counting it and what it leaves out
 * (entries indexed since, gone from the lore, held by another job), then each entry's lines and text as the next batch lays them
 * out; the part's line for a batch with nothing left to index in it; for a number the plan does not have, the line that says which
 * numbers it has.
 */
export async function loreNumberedBlock(index: LoreIndex, at: LoreAt, guidance: Guidance, n: number, agent?: AgentRef): Promise<string> {
  try {
    const lines = await loreLines(guidance);
    const plan = await index.plan(at, agent?.job);
    const batch = plan.batches[n - 1];
    if (batch === undefined) return loreLine(lines, "batch_no_number", { n, batches: plan.batches.length }) ?? "";
    const fields = { n, batches: plan.batches.length, count: batch.entries.length, size: batch.count, indexed: batch.indexed, gone: batch.gone, held: batch.held };
    if (batch.entries.length === 0) return loreLine(lines, "batch_number_done", fields) ?? "";
    const head = loreLine(lines, "batch_number_head", fields);
    return [...(head === undefined ? [] : [head]), ...entryBlocks(lines, batch.entries)].join("\n\n");
  } catch (error) {
    return await unreadable(guidance, error);
  }
}

/** Characters to a token, as the turn counts what it gives against a budget. */
const CHARS_PER_TOKEN = 3.2;

/**
 * The secrets a character holds as the lines word them, a head line first: each by the answers' line `held_secret` (its words, how it came by
 * it as one flag of `how_authored`, `how_witnessed`, `how_told`, `how_inferred` or `how_guessed`, and `by`, who told it), in the world's order,
 * within the tokens the budget allows; a line that does not fit is left out and the next tried. Nothing where the part has no such line.
 */
function heldText(lines: LinesPart | undefined, held: { secrets: readonly HeldSecret[]; budget: number }): string {
  let left = held.budget;
  const rows: string[] = [];
  for (const s of held.secrets) {
    const line = loreLine(lines, "held_secret", { id: s.id, title: s.title, text: s.text, how: s.how, how_authored: s.how === "authored" ? true : undefined, how_witnessed: s.how === "witnessed" ? true : undefined, how_told: s.how === "told" ? true : undefined, how_inferred: s.how === "inferred" ? true : undefined, how_guessed: s.how === "guessed" ? true : undefined, by: s.by ?? undefined });
    const cost = line === undefined ? 0 : Math.ceil(line.length / CHARS_PER_TOKEN);
    if (line === undefined || cost > left) continue;
    left -= cost;
    rows.push(line);
  }
  return rows.length === 0 ? "" : [loreLine(lines, "held_head"), ...rows].filter((part) => part !== undefined).join("\n");
}

/**
 * The `index:known-to-self` block for an agent: the lore bound as known to the character it plays
 * (`LoreIndex.knownTo`), each entry's line and its text, worded by the lines in force, then the secrets
 * it holds, within the budget (`LoreIndex.held`); the part's line that says there is none, when there
 * is neither. Nothing for an agent that plays no one in the chat's world.
 */
export async function loreKnownBlock(index: LoreIndex, at: LoreAt, agent: AgentRef, guidance: Guidance): Promise<string> {
  const known = agent.plays === undefined ? null : await index.knownTo(at, agent.plays);
  const held = agent.plays === undefined || known === null ? null : await index.held(at, agent.plays);
  if (known === null || held === null) return "";
  const lines = await loreLines(guidance);
  const secrets = heldText(lines, held);
  if (known.length === 0 && secrets === "") return loreLine(lines, "known_none") ?? "";
  const out: string[] = [];
  for (const e of known) {
    const fields = { id: e.id, title: e.title, source: e.source, keys: listField(e.keys), text: e.text };
    const parts = ["known_entry", "known_text"].flatMap((name) => loreLine(lines, name, fields) ?? []);
    if (parts.length > 0) out.push(parts.join("\n"));
  }
  if (secrets !== "") out.push(secrets);
  return out.join("\n\n");
}

// ---------------------------------------------------------------- answers

/** An answer being made, in the shape of the engine's tools' answers: data as JSON, then lines of the answers' part. */
class Answer {
  readonly content: ToolContent[] = [];
  failed = false;

  constructor(readonly lines: LinesPart | undefined) {}

  data(value: JsonValue): this {
    this.content.push({ type: "text", text: JSON.stringify(value) });
    return this;
  }

  line(name: string, fields: Fields = {}): this {
    const text = loreLine(this.lines, name, fields);
    if (text !== undefined) this.content.push({ type: "text", text });
    return this;
  }

  text(text: string): this {
    if (text.trim() !== "") this.content.push({ type: "text", text });
    return this;
  }

  fail(): this {
    this.failed = true;
    return this;
  }

  result(): ToolResult {
    return { content: this.content, ...(this.failed ? { error: true as const } : {}) };
  }
}

/** A lore tool as code holds it: everything but its words. */
interface LoreToolSpec {
  name: string;
  family: string;
  tier: "read" | "write";
  lane?: string;
  properties: Record<string, JsonObject>;
  required: readonly string[];
  run(args: JsonObject, call: { at: LoreAt; ctx: ToolCtx; deps: LoreToolDeps; answer: Answer }): Promise<Answer>;
}

/** The schema with each argument's text where the tool's file gives one, by its path through properties and list items (`entries.kind`). */
function described(properties: Readonly<Record<string, JsonObject>>, required: readonly string[], said: Readonly<Record<string, unknown>>): JsonSchema {
  const walk = (schema: JsonObject, path: string): JsonObject => {
    const out: JsonObject = { ...schema };
    const text = said[path];
    if (typeof text === "string") out.description = text.trim();
    const props = schema.properties;
    if (typeof props === "object" && props !== null && !Array.isArray(props)) out.properties = Object.fromEntries(Object.entries(props).map(([name, inner]) => [name, walk(inner as JsonObject, `${path}.${name}`)]));
    const items = schema.items;
    if (typeof items === "object" && items !== null && !Array.isArray(items)) out.items = walk(items as JsonObject, path);
    return out;
  };
  return { type: "object", properties: Object.fromEntries(Object.entries(properties).map(([name, schema]) => [name, walk(schema, name)])), ...(required.length > 0 ? { required: [...required] } : {}) };
}

// ---------------------------------------------------------------- lore_index_write

const TEXT: JsonObject = { type: "string" };

/** A field of the indexer's file as a run sent it: a text, a number or a list of them as texts, one line each; nothing for any other shape or an empty one. */
function namedValue(value: unknown): string | string[] | null {
  const one = (v: unknown): string | null => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : null);
  if (Array.isArray(value)) {
    const list = value.flatMap((v) => one(v) ?? []).filter((v) => v !== "");
    return list.length > 0 ? list : null;
  }
  const text = one(value);
  return text === null || text === "" ? null : text;
}

/** Reads one entry a run handed back: its lines and the revision it read them from, or what of it cannot be read. */
function readInput(raw: unknown): { input: LoreIndexInput } | { needs: string[] } | { unreadable: string; value: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { unreadable: "entry", value: JSON.stringify(raw ?? null) };
  const given = raw as Record<string, unknown>;
  const text = (name: string): string | null => (typeof given[name] === "string" && (given[name] as string).trim() !== "" ? (given[name] as string).replace(/\s+/g, " ").trim() : null);
  const id = text("id");
  const kind = text("kind");
  const line = text("line");
  // A book entry's revision is Lumiverse's number, which a model may send as one.
  const revision = typeof given.revision === "number" && Number.isFinite(given.revision) ? String(given.revision) : text("revision");
  const needs = [...(id === null ? ["id"] : []), ...(revision === null ? ["revision"] : []), ...(kind === null ? ["kind"] : []), ...(line === null ? ["line"] : [])];
  if (id === null || revision === null || kind === null || line === null) return { needs };
  for (const name of ["defines", "related"]) if (given[name] !== undefined && !Array.isArray(given[name])) return { unreadable: name, value: JSON.stringify(given[name]) };
  const defines = ((given.defines as unknown[] | undefined) ?? []).flatMap((b): LoreBinding[] => {
    if (typeof b === "string" && b.trim() !== "") return [{ what: b.trim(), aspect: "" }];
    if (typeof b !== "object" || b === null) return [];
    const { what, aspect } = b as Record<string, unknown>;
    return typeof what === "string" && what.trim() !== "" ? [{ what: what.trim(), aspect: typeof aspect === "string" ? aspect.trim() : "" }] : [];
  });
  const related = ((given.related as unknown[] | undefined) ?? []).filter((r): r is string => typeof r === "string" && r.trim() !== "").map((r) => r.trim());
  // Every other field a run sent is a field of the indexer's file (plan D.2): kept by its name, whatever the file has added.
  const fields: LoreNamedFields = {};
  for (const [name, value] of Object.entries(given)) {
    const kept = isFieldName(name) ? namedValue(value) : null;
    if (kept !== null) fields[name] = kept;
  }
  return { input: { id, revision, kind, line, defines, related, fields } };
}

export const LORE_INDEX_WRITE: LoreToolSpec = {
  name: "lore_index_write",
  family: LORE_INDEX_FAMILY,
  tier: "write",
  lane: LORE_LANE,
  // Nothing is held back by the schema: an entry that cannot be read is answered in the answers' words, and a field the indexer's file adds is carried as it is named.
  properties: { entries: { type: "array", items: { type: "object", additionalProperties: true, properties: { id: TEXT, revision: TEXT, kind: TEXT, line: TEXT, defines: { type: "array", items: { type: "object", properties: { what: TEXT, aspect: TEXT } } }, related: { type: "array", items: TEXT } } } } },
  required: [],
  async run(args, { at, ctx, deps, answer }) {
    const list = args.entries;
    if (!Array.isArray(list) || list.length === 0) return answer.line("no_entries").fail();
    const inputs: { n: number; input: LoreIndexInput }[] = [];
    for (const [i, raw] of list.entries()) {
      const read = readInput(raw);
      const n = i + 1;
      if ("input" in read) inputs.push({ n, input: read.input });
      else if ("needs" in read) answer.line("needs", { n, fields: read.needs });
      else answer.line("unreadable", { n, field: read.unreadable, value: read.value });
    }
    const outcomes = await deps.index.write(at, inputs.map((i) => i.input), ctx.agent.definition, ctx.agent.job);
    const kept: JsonObject[] = [];
    for (const [i, outcome] of outcomes.entries()) {
      if ("unknown" in outcome) answer.line("unknown_entry", { n: inputs[i]?.n ?? 0, id: outcome.id });
      else kept.push({ id: outcome.id, title: outcome.kept.title, kind: outcome.kept.kind, line: outcome.kept.line, defines: outcome.kept.defines.map((b) => ({ what: b.what, aspect: b.aspect })), related: outcome.kept.related, ...outcome.kept.fields });
    }
    const next = await deps.index.batch(at, undefined, ctx.agent.job);
    answer.data({ kept, left: next.left });
    answer.line("kept", { count: kept.length, left: next.left });
    if (kept.length === 0) answer.fail();
    return answer.text(batchText(answer.lines, next));
  },
};

/** What the lore's tools are given by the host (the turn lane). */
export interface LoreToolDeps {
  index: LoreIndex;
  /** The guidance in force for the chat: each tool's words from its file, every answer's from `.prompts/lore-answers.md`. */
  guidance: Guidance;
  /** Where a fault of a tool's own is logged. */
  log?: Log;
}

export const LORE_TOOLS: readonly LoreToolSpec[] = [LORE_INDEX_WRITE];

/** The lore's tools for a chat, as RPH holds them. A tool whose file is not in force for the chat (switched off) is not offered. */
export async function loreTools(deps: LoreToolDeps): Promise<HostTool[]> {
  const lines = await loreLines(deps.guidance);
  const out: HostTool[] = [];
  for (const spec of LORE_TOOLS) {
    const file = await deps.guidance.tool(spec.name);
    if (file === undefined || file.format !== "template") continue;
    const said = file.header.arguments;
    out.push({
      name: spec.name,
      family: spec.family,
      tier: spec.tier,
      ...(spec.lane !== undefined ? { lane: spec.lane } : {}),
      description: file.render().text.trim(),
      parameters: described(spec.properties, spec.required, typeof said === "object" && said !== null && !Array.isArray(said) ? said : {}),
      async run(args: JsonValue, ctx: ToolCtx): Promise<ToolResult> {
        const given = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
        // A job of no chat has no chat's lore to index: said in the answers' words (`no_chat`), nothing written.
        if (ctx.scope.chat === undefined) return new Answer(lines).data({ refused: "no_chat" }).line("no_chat", { tool: spec.name }).fail().result();
        const at: LoreAt = { user: ctx.scope.user, chat: ctx.scope.chat, ...(ctx.scope.turn !== undefined ? { turn: ctx.scope.turn } : {}) };
        const call = { at, ctx, deps, answer: new Answer(lines) };
        try {
          return (await spec.run(given, call)).result();
        } catch (error) {
          // Never a bare failure: a reason the caller can act on is a refusal in the answers' words; anything else is a fault of RPE's own, logged, its error in the call's details.
          const refused = new Answer(lines);
          if (error instanceof LoreRefusal) return refused.data({ refused: error.line }).line(error.line, error.fields).fail().result();
          // A turn that was joined to another (a continue's held turn) is never read for its state: said as the fact the store gives, in the answers' words.
          if (error instanceof JoinedTurnError) return refused.data({ joined: { turn: error.turn, joined: error.joined } }).line("joined", { turn: error.turn, joined: error.joined }).fail().result();
          const said = error instanceof Error ? error.message : String(error);
          deps.log?.error("A lore tool failed.", { tool: spec.name, error: said });
          return { ...refused.data({ fault: spec.name }).line("fault", { tool: spec.name }).fail().result(), details: { fault: spec.name, error: said } };
        }
      },
    });
  }
  return out;
}
