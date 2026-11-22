// `cast_query` (plan §7.1, §6.8): a character's record as it stands on the call's path, part by part,
// or with no character named, who is in the cast there and as what. Sources are read live, each
// marked when the base is older than it. It reads only. It picks by the record's own marks, names and
// words, never by what an entry means, and answers in the record's order. Asked `how: gist` (plan 3.2
// §7.1) it gives each entry by what the record itself holds that stands for it, with the size of the
// entry whole: the gists a character's own outline and `self_read` give (`zoom.ts`), of the record as the
// omniscient side reads it. Asked a `question` (§7.4), its answer goes to a reader, which answers the
// question from it (`hostTool`).

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, QUESTION, type Reply, TEXT, WHOLE, YES_NO } from "../iface/kit";
import { nearestOf } from "../iface/reading";
import { textOf } from "../iface/texts";
import { askOf, holdingsFor, minds, whoKnows } from "./knowledge";
import { baseView, type CastCall, type CastReading, type CastToolSpec, growthOver, itemView, nearOf, readingOr, sourceView, whoView } from "./kit";
import { perceptionView } from "./perceive";
import { baseHistory, baseOf, bindingsOf, type CastItem, castingInForce, castingItemId, castOn, charactersOf, findCharacter, nameKey, type RowPart } from "./record";
import { sourcesNow } from "./sources";
import { towardOf } from "./refs";
import { type GistOf, gistOf, GISTS, sizeOf } from "./zoom";

/** The parts a query can ask for, as the record's table names them. */
export const QUERY_PARTS = ["sources", "base", "casting", "growth", "mind", "relationships", "knowledge", "history", "perceptions", "away"] as const;
type QueryPart = (typeof QUERY_PARTS)[number];

/** The parts kept as rows, by the name a query gives them. */
const ROWS: Readonly<Partial<Record<QueryPart, RowPart>>> = { growth: "growth", mind: "mind", relationships: "relationship", knowledge: "knowledge", history: "history", perceptions: "perception", away: "away" };

/** What stands for an entry of each of those parts, asked by gist (`GISTS`). */
const ROW_GISTS: Readonly<Partial<Record<RowPart, GistOf>>> = { growth: GISTS.growth, mind: GISTS.mind, relationship: GISTS.relationship, knowledge: GISTS.knowledge, history: GISTS.history, perception: GISTS.perception, away: GISTS.away };

/** How an answer gives each entry (plan 3.2 §7.1): whole, as when nothing is said, or by its gist. A part of the record is asked for by the tool's own arguments. */
const HOWS = ["gist", "whole"] as const;

const QUERY_PROPERTIES: Record<string, JsonObject> = {
  who: TEXT,
  part: oneOf(QUERY_PARTS),
  with: TEXT,
  words: TEXT,
  secret: TEXT,
  history: YES_NO,
  skip: WHOLE,
  how: oneOf(HOWS),
  ...QUESTION,
};

/** Whether every one of `words` is in what an entry says, case ignored. */
function says(item: CastItem, words: readonly string[]): boolean {
  const text = Object.values(item.fields)
    .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []))
    .join("\n")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Who is in the cast on this path, and as what. */
function castList(call: CastCall, reading: CastReading, reply: Reply): Reply {
  const members = castOn(reading.record, charactersOf(call.deps.store.db, call.scope.user, reading.chats));
  if (members.length === 0) return reply.line("no_cast", {});
  return reply.data({ cast: members.map((m) => ({ ...whoView(m.character), casting: m.as, ...(m.pinned ? { pinned: true } : {}), ...(m.line !== null ? { line: m.line } : {}) })) });
}

async function query(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  // The choices go in as one list in words: a list of values would say the sentence once for each.
  const unreadable = (field: string, value: JsonValue | undefined, choices: readonly JsonValue[] = []): Reply => reply.line("unreadable", { field, value: JSON.stringify(value), choices: textOf(choices) }).fail();
  const part = args.part;
  if (part !== undefined && !(QUERY_PARTS as readonly JsonValue[]).includes(part)) return unreadable("part", part, QUERY_PARTS);
  for (const field of ["who", "with", "words"]) if (args[field] !== undefined && typeof args[field] !== "string") return unreadable(field, args[field]);
  if (args.history !== undefined && typeof args.history !== "boolean") return unreadable("history", args.history, [true, false]);
  if (args.skip !== undefined && !(typeof args.skip === "number" && Number.isInteger(args.skip) && args.skip >= 0)) return unreadable("skip", args.skip);
  if (args.how !== undefined && !(HOWS as readonly JsonValue[]).includes(args.how)) return unreadable("how", args.how, HOWS);

  const reading = readingOr(call, reply);
  if (reading === null) return reply;
  const history = args.history === true;
  const words = typeof args.words === "string" ? args.words.toLowerCase().split(/\s+/).filter((w) => w !== "") : [];
  // A question of knowledge may name a secret by the id the lore shows it by: it is asked of the fact that id is.
  const ask = await askOf(call, words, typeof args.secret === "string" ? args.secret : undefined);
  if ("none" in ask) return unreadable("secret", ask.none);
  const { db } = call.deps.store;
  const user = call.scope.user;
  // With no one named, the cast; asked of knowledge (or of a secret), who across the cast knows it.
  if (typeof args.who !== "string" || args.who.trim() === "") {
    if (part !== "knowledge" && typeof args.secret !== "string") return castList(call, reading, reply);
    const knowers = whoKnows(call, reading, charactersOf(db, user, reading.chats), ask);
    if (knowers.length === 0) return reply.line("no_knowers", {});
    return reply.data({ knowers });
  }
  const character = findCharacter(db, user, reading.chats, args.who);
  if (character === null) {
    const near = nearOf(call);
    return reply.line("no_character", { who: args.who.trim(), near: textOf(nearestOf(args.who, charactersOf(db, user, reading.chats).map((c) => c.name), near).slice(0, near.nearMatches)) }).fail();
  }

  const casting = castingInForce(reading.record, character);
  const castingNow: JsonObject | null = casting === null ? null : { as: casting.as, ...(casting.pinned ? { pinned: true } : {}), ...(casting.line !== null ? { line: casting.line } : {}) };
  const data: JsonObject = { character: { ...whoView(character), casting: castingNow } };
  if (casting === null) reply.line("not_cast", { who: character.name });
  const parts = part === undefined ? QUERY_PARTS : [part as QueryPart];
  // Asked by gist: each entry by what the record holds that stands for it, and the same entries whole, for the line that says how much this shows of how much.
  const gists = args.how === "gist";
  const { tokens } = call.deps;
  const brief: JsonObject[] = [];
  const full: JsonObject[] = [];
  const gist = (spec: GistOf, whole: JsonObject): JsonObject => {
    const given = gistOf(spec, whole, tokens);
    brief.push(given);
    full.push(whole);
    return given;
  };

  if (parts.includes("sources") || parts.includes("base")) {
    const base = baseOf(db, user, character.id, call.scope.chat);
    const states = await sourcesNow(call.deps.sources, { user, chat: call.scope.chat }, bindingsOf(db, user, character.id), base.values());
    if (parts.includes("sources")) data.sources = states.map(sourceView);
    if (parts.includes("base")) {
      const older = states.filter((s) => s.newer);
      // Growth is laid over the base wherever the base is shown.
      const growth = growthOver(reading, character.id);
      const versions = baseView(base, history ? baseHistory(db, user, character.id, call.scope.chat) : null);
      const shown = gists ? Object.fromEntries(Object.entries(versions).map(([name, v]) => [name, Array.isArray(v) ? v.map((one) => gist(GISTS.base, one as JsonObject)) : gist(GISTS.base, v as JsonObject)])) : versions;
      data.base = { ...shown, ...(growth.length > 0 ? { growth: gists ? growth.map((g) => gist(GISTS.growth, g)) : growth } : {}), ...(older.length > 0 ? { older_than: older.map(sourceView) } : {}) };
    }
  }
  if (parts.includes("casting") && history) {
    const item = reading.record.items.get(castingItemId(character.id));
    if (item !== undefined) data.casting = itemView(reading, item, true);
  }

  // A relationship is toward whoever it is by reference (a character, the world's person, or the name when it is neither), so a rename or a nickname finds it as the name written does.
  const toward = typeof args.with === "string" && args.with.trim() !== "" ? towardOf(db, user, reading.chats, minds(call), args.with) : null;
  const towardThem = (item: CastItem): boolean => toward === null || item.fields.toward === toward.ref || nameKey(String(item.fields.with ?? "")) === nameKey(toward.name);
  const skip = typeof args.skip === "number" ? args.skip : 0;
  const more: { count: number; part: string; skip: number; tokens?: number }[] = [];
  for (const name of parts) {
    const rowPart = ROWS[name];
    if (rowPart === undefined) continue;
    const matches = reading.record
      .of(character.id, rowPart, history)
      .filter((item) => (rowPart !== "relationship" || towardThem(item)) && says(item, words) && (rowPart !== "knowledge" || ask.fact === null || item.fields.secret === ask.fact));
    const shown = matches.slice(skip, skip + call.settings.queryItems);
    const view = (item: CastItem): JsonObject => (rowPart === "perception" ? { ...perceptionView(reading, item), ...(history ? { history: itemView(reading, item, true).history ?? [] } : {}) } : { ...itemView(reading, item, history), ...(rowPart === "knowledge" ? { kept_in: "cast" } : {}) });
    const spec = gists ? ROW_GISTS[rowPart] : undefined;
    data[name] = shown.map((item) => (spec === undefined ? view(item) : gist(spec, view(item))));
    // What is left out is counted, and sized where a counter is given: an answer that is not the whole says how much more there is.
    const rest = matches.slice(skip + shown.length);
    const left = rest.length > 0 ? sizeOf(rest.map(view), tokens) : undefined;
    if (rest.length > 0) more.push({ count: rest.length, part: name, skip: skip + shown.length, ...(left !== undefined ? { tokens: left } : {}) });
  }
  // What the minds' own record holds for the world's person it is: the facts it holds and the secrets, each as the minds keep it.
  if (parts.includes("knowledge")) {
    const held = holdingsFor(minds(call), character, ask);
    if (held.length > 0) data.held = gists ? held.map((h) => gist(GISTS.held, h)) : held;
  }
  reply.data(data);
  if (brief.length > 0) reply.line("gists", { items: brief.length, ...(brief.length === 1 ? { one: true } : {}), ...(brief.some((g) => g.first !== undefined) ? { first: true } : {}), ...(tokens !== undefined ? { shown: tokens(JSON.stringify(brief)), whole: sizeOf(full, tokens) ?? 0 } : {}) });
  for (const m of more) reply.line("more", m);
  return reply;
}

export const CAST_QUERY: CastToolSpec = {
  name: "cast_query",
  family: "cast",
  tier: "read",
  properties: QUERY_PROPERTIES,
  required: [],
  example: { who: "Bram", part: "relationships", with: "Wren" },
  run: query,
};
