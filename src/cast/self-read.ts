// `self_read` (plan 3.2 §6.4, §7.1): a character's own record, opened a part at a time by the agent that plays it. A character's
// agent starts with a small standing self and an outline of the rest; this is the call the outline's lines name. It reads what it
// perceived and has not taken in, its old mind files not yet filed, its memories, how it feels about people, what it knows, its
// history and its game side: by id or a range of ids, by day, by scene, by name, by subject or by tier, as each part takes; whole,
// or by gist (`how`), an answer that is not everything it matched saying how much it shows of how much and the call that reads on.
// Asked a `question` (§7.4), its answer goes to a reader, which answers the question from it (`hostTool`).
//
// It acts for the character the calling agent plays (`AgentRef.plays`) and for no one else: asked of another character, or by an agent
// that plays nobody, it answers with why not, and an id that is none of the character's own is answered as one it does not have,
// whoever's it is. What it answers is what the character may know: every entry is made by `zoom.ts` (a perception from the fields
// that reached the character alone), a memory is shown as the character's own answers show it (a faded one by its gist: `recall`
// is what brings one back in full), and a perception it has taken in is not read again here, since its memories hold what it kept.
// It reads only: it picks by the record's own marks, names, dates and words, never by what an entry means, and answers in the
// record's order.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, QUESTION, type Reply, TEXT, WHOLE } from "../iface/kit";
import { nearestOf } from "../iface/reading";
import { textOf } from "../iface/texts";
import { type CastCall, type CastToolSpec, nearIds } from "./kit";
import { memoryView } from "./memories";
import { memoriesNow, type Tier } from "./memory";
import { perceivedTurn } from "./perceive";
import { findCharacter, nameKey } from "./record";
import { towardOf } from "./refs";
import { worldAt } from "./secrets";
import { type Self, selfOr } from "./self";
import { mindsShown } from "./views";
import { filesWaiting, type GistOf, gistOf, GISTS, ownHistory, ownKnowledge, type OwnReading, ownRelationship, sideData, sideFields, sideGist, untakenSized } from "./zoom";

/** The parts of its own record a character reads. */
const SELF_PARTS = ["perceptions", "imported", "memories", "relationships", "knowledge", "history", "game-side"] as const;
type SelfPart = (typeof SELF_PARTS)[number];
/** A part that is a list of entries: every one but the game side, which is one thing. */
type ListPart = Exclude<SelfPart, "game-side">;

/** How an answer gives each entry (plan 3.2 §7.1): whole, as when nothing is said, or by its gist. What of a part is read is asked by the tool's own arguments. */
const HOWS = ["gist", "whole"] as const;
const TIERS: readonly Tier[] = ["top", "short", "long"];

/** The arguments that say what of a part is read. */
const SELECTORS = ["id", "to", "day", "scene", "name", "subject", "tier", "skip"] as const;
type Selector = (typeof SELECTORS)[number];

/** What each part is read by, besides whole and by gist. */
const TAKES: Readonly<Record<SelfPart, readonly Selector[]>> = {
  perceptions: ["id", "to", "day", "scene", "subject", "skip"],
  imported: ["name"],
  memories: ["id", "to", "day", "tier", "name", "subject", "skip"],
  relationships: ["id", "name", "subject", "skip"],
  knowledge: ["id", "to", "name", "subject", "skip"],
  history: ["id", "to", "day", "subject", "skip"],
  "game-side": [],
};

const READ_PROPERTIES: Record<string, JsonObject> = {
  part: oneOf(SELF_PARTS),
  id: TEXT,
  to: TEXT,
  day: TEXT,
  scene: TEXT,
  name: TEXT,
  subject: TEXT,
  tier: oneOf(TIERS),
  skip: WHOLE,
  how: oneOf(HOWS),
  who: TEXT,
  ...QUESTION,
};

/** One entry of a part, as the character may read it. */
interface Entry {
  id: string;
  whole: JsonObject;
  /** Story time it is of, for its day; null where it keeps none. */
  at: number | null;
  /** The turn it is of, for its scene: a perception's. */
  turn: string | null;
  /** The people, things and names it goes by, as `name` finds it. */
  names: readonly string[];
  tier?: Tier;
  faint?: boolean;
  /** Its size, where the record's lists size it otherwise than by what an answer holds of it: an old mind file, by its text. */
  tokens?: number;
}

/** Every text a value holds, however deep. */
function textsIn(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(textsIn) : [];
}

/** The texts of a field that holds a name or a list of them. */
const namesIn = (value: JsonValue | undefined): string[] => textsIn(value).filter((text) => text.trim() !== "");

/** What stands for an entry of each part (`GISTS`). */
const GIST_OF: Readonly<Record<ListPart, GistOf>> = { perceptions: GISTS.perception, imported: GISTS.file, memories: GISTS.memory, relationships: GISTS.relationship, knowledge: GISTS.knowledge, history: GISTS.history };

/** A part's entries, every one the character holds of it, in the record's order. */
function entriesOf(part: ListPart, own: OwnReading, self: Self, call: CastCall): Entry[] {
  const { record, clock } = own;
  const size = call.deps.tokens ?? (() => 0);
  switch (part) {
    case "perceptions":
      return untakenSized(own, self.character.id, size).map((p) => ({ id: p.item.id, whole: p.view, at: p.item.at, turn: perceivedTurn(p.item), names: namesIn(p.view.told_by) }));
    case "imported":
      return filesWaiting(own, self.character.id, size).map((file): Entry => {
        // A file's text, word for word; the older minds pack's notes with the names and dates the world gives them now, as their view lays them out.
        const whole: JsonObject = file.text !== null ? { file: file.file, text: file.text } : { file: file.file, ...mindsShown(file.item.fields.minds as JsonObject, worldAt(own.store, own.user, own.turn, own.job, own.chat), clock) };
        return { id: file.file, whole, at: null, turn: null, names: [file.file, file.file.replace(/\.md$/i, ""), file.item.id], tokens: file.tokens };
      });
    case "memories":
      return memoriesNow(record, self.character.id, self.now, call.settings).map((m) => ({ id: m.item.id, whole: memoryView(m, clock), at: m.item.at, turn: null, names: [...namesIn(m.item.fields.who), ...namesIn(m.item.fields.about)], tier: m.tier, faint: m.faint }));
    case "relationships": {
      const ctx = worldAt(own.store, own.user, own.turn, own.job, own.chat);
      return record.of(self.character.id, "relationship").map((item) => {
        const whole = ownRelationship(own, ctx, item);
        return { id: item.id, whole, at: null, turn: null, names: [...namesIn(whole.with), ...namesIn(item.fields.with), ...namesIn(item.fields.toward)] };
      });
    }
    case "knowledge":
      return ownKnowledge(own, self.character.id).map((whole) => ({ id: String(whole.id), whole, at: record.items.get(String(whole.id))?.at ?? null, turn: null, names: [...namesIn(whole.about), ...namesIn(whole.told_by)] }));
    case "history":
      return ownHistory(own, self.character.id).map((whole) => ({ id: String(whole.id), whole, at: record.items.get(String(whole.id))?.at ?? null, turn: null, names: [] }));
  }
}

async function selfRead(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  // The choices go in as one list in words: a list of values would say the sentence once for each.
  const unreadable = (field: string, value: JsonValue | undefined, choices: readonly JsonValue[] = []): Reply => reply.line("unreadable", { field, value: JSON.stringify(value), choices: textOf(choices) }).fail();
  const part = args.part;
  if (part !== undefined && !(SELF_PARTS as readonly JsonValue[]).includes(part)) return unreadable("part", part, SELF_PARTS);
  if (args.how !== undefined && !(HOWS as readonly JsonValue[]).includes(args.how)) return unreadable("how", args.how, HOWS);
  if (args.tier !== undefined && !(TIERS as readonly JsonValue[]).includes(args.tier)) return unreadable("tier", args.tier, TIERS);
  for (const field of ["id", "to", "day", "scene", "name", "subject", "who"]) if (args[field] !== undefined && typeof args[field] !== "string") return unreadable(field, args[field]);
  if (args.skip !== undefined && !(typeof args.skip === "number" && Number.isInteger(args.skip) && args.skip >= 0)) return unreadable("skip", args.skip);
  const said = (field: string): string | undefined => {
    const value = args[field];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };

  // The character the calling agent plays, and no other: an agent that plays nobody is told so, and one asked of anyone else is told why not.
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const { db } = call.deps.store;
  const asked = said("who");
  if (asked !== undefined && findCharacter(db, call.scope.user, self.reading.chats, asked)?.id !== self.character.id) return reply.line("own_other", { tool: call.tool, who: self.character.name, asked }).fail();

  const own: OwnReading = { store: call.deps.store, user: call.scope.user, chat: call.scope.chat, chats: self.reading.chats, turn: call.scope.turn ?? null, job: call.agent.job ?? null, record: self.reading.record, clock: self.reading.clock };
  const { tokens } = call.deps;
  /** An entry's size whole, in tokens as the chat counts them: what the outline's line for it says. */
  const sizeOfEntry = (count: (text: string) => number, entry: Entry): number => entry.tokens ?? count(JSON.stringify(entry.whole));
  /** The size of entries together: each one's own, added up, as the outline's lines add them. */
  const total = (count: (text: string) => number, entries: readonly Entry[]): number => entries.reduce((sum, entry) => sum + sizeOfEntry(count, entry), 0);
  /** That size as an answer's line takes it; nothing where the host hands no counter. */
  const sized = (entries: readonly Entry[]): { tokens: number } | Record<string, never> => (tokens === undefined ? {} : { tokens: total(tokens, entries) });
  const gists = args.how === "gist";

  // With no part named: every part, with how many entries it holds and how large it is whole.
  if (part === undefined) {
    const side = sideFields(own, self.character);
    const parts = SELF_PARTS.map((name): JsonObject => {
      if (name === "game-side") return { part: name, count: side === null ? 0 : 1, ...(side === null || tokens === undefined ? {} : { tokens: tokens(JSON.stringify(sideData(side))) }) };
      const entries = entriesOf(name, own, self, call);
      return { part: name, count: entries.length, ...(entries.length === 0 ? {} : sized(entries)) };
    });
    return reply.data({ who: self.character.name, parts }).line("own_parts", { tool: call.tool, ...(tokens !== undefined ? { sized: true } : {}) });
  }
  const name = part as SelfPart;
  const given = SELECTORS.filter((field) => args[field] !== undefined && args[field] !== "");
  const stray = given.find((field) => !TAKES[name].includes(field));
  if (stray !== undefined) return reply.line("own_not_by", { part: name, field: stray, takes: textOf([...TAKES[name]]) }).fail();

  if (name === "game-side") {
    const side = sideFields(own, self.character);
    if (side === null) return reply.line("own_no_side", {});
    const whole = sideData(side);
    if (!gists) return reply.data({ "game-side": whole });
    const gist = sideGist(side, tokens);
    return reply.data({ "game-side": gist }).line("own_side_names", { tool: call.tool, ...(tokens !== undefined ? { shown: tokens(JSON.stringify(gist)), whole: tokens(JSON.stringify(whole)) } : {}) });
  }

  const all = entriesOf(name, own, self, call);
  let matches = all;
  // One entry by its id, or a range of them in the record's order, both ends read; `to` alone reads from the first.
  const [from, to] = [said("id"), said("to")];
  if (from !== undefined || to !== undefined) {
    const places: number[] = [];
    for (const id of [from, to]) {
      if (id === undefined) continue;
      const at = all.findIndex((entry) => entry.id === id);
      if (at < 0) {
        // A perception of its own that it has taken in is no longer read here; any other id is one it does not have, whoever's it is.
        const item = self.reading.record.items.get(id);
        if (name === "perceptions" && item !== undefined && item.part === "perception" && item.character === self.character.id && !item.dropped) return reply.line("own_taken", { id }).fail();
        return reply.line("own_unknown_id", { part: name, id: JSON.stringify(id), near: textOf(nearIds(id, all.map((entry) => entry.id), self.near)) }).fail();
      }
      places.push(at);
    }
    matches = to === undefined ? all.slice(places[0], (places[0] ?? 0) + 1) : all.slice(from === undefined ? 0 : Math.min(...places), Math.max(...places) + 1);
  }
  if (all.length === 0) return reply.line("own_none", { part: name });
  const day = said("day");
  if (day !== undefined) {
    const { clock } = own;
    const dayOf = (entry: Entry): string | null => (entry.at === null || clock === null ? null : clock.day(entry.at));
    const days = [...new Set(all.flatMap((entry) => dayOf(entry) ?? []))];
    if (days.length === 0) return reply.line("own_no_days", { part: name, ...(TAKES[name].includes("scene") ? { scenes: true } : {}) }).fail();
    matches = matches.filter((entry) => nameKey(dayOf(entry) ?? "") === nameKey(day));
    if (matches.length === 0) return reply.line("own_unknown_day", { part: name, day, days: textOf(nearestOf(day, days, self.near).slice(0, self.near.nearMatches)) });
  }
  // A scene by its id, as the outline names it: its title is the story record's words, which never reach the character.
  const scene = said("scene");
  if (scene !== undefined) {
    const turns = [...new Set(all.flatMap((entry) => entry.turn ?? []))];
    const sceneOf = call.deps.scenes?.({ user: call.scope.user, chat: call.scope.chat }, call.scope.turn ?? null, turns) ?? new Map<string, string | null>();
    const scenes = [...new Set([...sceneOf.values()].flatMap((s) => (s === null ? [] : [s])))];
    if (scenes.length === 0) return reply.line("own_no_scenes", { part: name }).fail();
    matches = matches.filter((entry) => entry.turn !== null && nameKey(sceneOf.get(entry.turn) ?? "") === nameKey(scene));
    if (matches.length === 0) return reply.line("own_unknown_scene", { part: name, scene, scenes: textOf(scenes.slice(Math.max(0, scenes.length - self.near.nearMatches))) });
  }
  if (typeof args.tier === "string") matches = matches.filter((entry) => entry.tier === args.tier);
  const named = said("name");
  if (named !== undefined) {
    // A person is found by reference too, as a relationship is kept: a nickname or an id joins the name they go by now.
    const toward = name === "relationships" ? towardOf(db, call.scope.user, self.reading.chats, worldAt(own.store, own.user, own.turn, own.job, own.chat), named) : null;
    const keys = new Set([named, ...(toward === null ? [] : [toward.ref, toward.name])].map(nameKey));
    matches = matches.filter((entry) => entry.names.some((one) => keys.has(nameKey(one))));
    if (name === "imported" && matches.length === 0) return reply.line("own_no_file", { name: named, files: textOf(all.map((entry) => entry.id)) }).fail();
  }
  const subject = said("subject");
  if (subject !== undefined) {
    const words = subject.toLowerCase().split(/\s+/).filter((word) => word !== "");
    matches = matches.filter((entry) => {
      const text = textsIn(entry.whole).join("\n").toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }
  if (matches.length === 0) return reply.line("own_none", { part: name, ...(given.length > 0 ? { narrowed: true } : {}) });

  const skip = typeof args.skip === "number" ? args.skip : 0;
  const shown = matches.slice(skip, skip + call.settings.queryItems);
  const wholes = shown.map((entry) => entry.whole);
  const rest = matches.slice(skip + shown.length);
  if (shown.length === 0) return reply.line("own_none", { part: name, narrowed: true });
  if (gists) {
    const brief = shown.map((entry): JsonObject => ({ ...gistOf(GIST_OF[name], entry.whole, tokens), ...(tokens !== undefined ? { tokens: sizeOfEntry(tokens, entry) } : {}) }));
    reply.data({ [name]: brief }).line("own_gists", { tool: call.tool, items: brief.length, ...(brief.length === 1 ? { one: true } : {}), ...(brief.some((g) => g.first !== undefined) ? { first: true } : {}), ...(tokens !== undefined ? { shown: tokens(JSON.stringify(brief)), whole: total(tokens, shown) } : {}) });
  } else reply.data({ [name]: wholes });
  // A memory that has faded is given by its gist, as the character's own answers give it: recalling it is what brings it back.
  const faint = shown.filter((entry) => entry.faint === true).length;
  if (faint > 0 && !gists) reply.line("own_faint", { count: faint, ...(faint === 1 ? { one: true } : {}) });
  // What is left out is counted and sized: an answer that is not all it matched says how much more there is, and the call that reads on.
  if (rest.length > 0) reply.line("own_more", { tool: call.tool, count: rest.length, skip: skip + shown.length, ...sized(rest) });
  return reply;
}

export const SELF_READ: CastToolSpec = {
  name: "self_read",
  family: "cast",
  tier: "read",
  properties: READ_PROPERTIES,
  required: [],
  example: { part: "perceptions", day: "Sat 1 Mar 2031", how: "gist" },
  run: selfRead,
};
