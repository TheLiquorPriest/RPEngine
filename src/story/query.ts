// `story_query` (plan §8.1, §6.8): any part of the story record as it stands on the call's path, by
// id, by a range of messages, by who is involved, by what is open, due or held hot, with each item's
// history when asked. It reads only. It picks by the record's own marks, names and positions, never by
// what an item says, and answers in the record's order. Asked `how: gist` (plan 3.2 §7.1) it gives each
// item by what the record itself holds that stands for it, its title and its summary, with the size of
// the item whole; code writes no summary of its own. Asked a `question` (§7.4), its answer goes to a
// reader, which answers the question from it (`hostTool`).

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { oneOf, QUESTION, type Reply, TEXT, WHOLE, YES_NO } from "../iface/kit";
import { textOf } from "../iface/texts";
import { questRefOf } from "../quests/read";
import { allSpans, itemView, namesOf, nearIds, placeRefOf, recordOr, type StoryCall, storyClock, type StoryToolSpec, treeOf } from "./kit";
import { nameKey, STORY_PARTS, type Span, type StoryItem, type StoryPart, type StoryRecord } from "./record";

/** How an answer gives each item (plan 3.2 §7.1): whole, as when nothing is said, or by its gist. A part of the record is asked for by the tool's own arguments. */
const HOWS = ["gist", "whole"] as const;

const QUERY_PROPERTIES: Record<string, JsonObject> = {
  part: oneOf(STORY_PARTS),
  id: TEXT,
  from: WHOLE,
  to: WHOLE,
  who: TEXT,
  place: TEXT,
  quest: TEXT,
  open: YES_NO,
  due: YES_NO,
  hot: YES_NO,
  history: YES_NO,
  how: oneOf(HOWS),
  ...QUESTION,
};

/**
 * An item by its gist, from its whole view: its id, where it lies, whether it is closed or dropped, and what the record holds that
 * stands for it, its title and its summary. An item with neither is given by the first line of its text that holds words (`first`),
 * which is no gist of anyone's writing: the answer's line says so. With a counter, `tokens` is the size of the item whole, as a
 * query by its id reads it.
 */
function gistView(whole: JsonObject, tokens: ((text: string) => number) | undefined): JsonObject {
  const out: JsonObject = { id: whole.id ?? null };
  for (const key of ["title", "summary"]) {
    const value = whole[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  if (out.title === undefined && out.summary === undefined && typeof whole.text === "string") {
    const first = whole.text.split("\n").find((line) => /[\p{L}\p{N}]/u.test(line));
    if (first !== undefined) out.first = first.trim();
  }
  for (const key of ["message", "from", "to", "closed", "dropped"]) if (whole[key] !== undefined) out[key] = whole[key] as JsonValue;
  if (tokens !== undefined) out.tokens = tokens(JSON.stringify(whole));
  return out;
}

/** The parts an item of which can be closed, and so be open. */
const CLOSABLE: Readonly<Partial<Record<StoryPart, true>>> = { chapter: true, scene: true, thread: true, future: true };

/** The messages an item lies in, a turn whose reply is not saved yet counting as after the last message: a beat's own, a scene's or chapter's span, the message a write names, else those of the turns that wrote it. */
function placeOf(record: StoryRecord, item: StoryItem, spans: ReadonlyMap<string, Span>): [number, number] {
  const after = record.at.messages.length;
  const span = spans.get(item.id);
  if (span !== undefined) return [span.from ?? after, span.to ?? after];
  if (item.part === "beat") {
    const at = record.beatAt(item) ?? after;
    return [at, at];
  }
  if (item.fields.message !== undefined) {
    const at = record.numberOf(item.fields.message) ?? after;
    return [at, at];
  }
  const touched = item.rows.map((r) => record.at.replyOf(r.turn) ?? after);
  return [Math.min(...touched), Math.max(...touched)];
}

async function query(args: JsonObject, call: StoryCall): Promise<Reply> {
  const reply = call.reply();
  // The choices go in as one list in words: a list of values would say the sentence once for each.
  const unreadable = (field: string, value: JsonValue | undefined, choices: readonly JsonValue[] = []): Reply => reply.line("unreadable", { field, value: JSON.stringify(value), choices: textOf(choices) }).fail();
  const part = args.part;
  if (part !== undefined && !(STORY_PARTS as readonly JsonValue[]).includes(part)) return unreadable("part", part, STORY_PARTS);
  for (const field of ["from", "to"]) if (args[field] !== undefined && !(typeof args[field] === "number" && Number.isInteger(args[field]))) return unreadable(field, args[field]);
  for (const field of ["open", "due", "hot", "history"]) if (args[field] !== undefined && typeof args[field] !== "boolean") return unreadable(field, args[field], [true, false]);
  if (args.who !== undefined && typeof args.who !== "string") return unreadable("who", args.who);
  if (args.place !== undefined && typeof args.place !== "string") return unreadable("place", args.place);
  if (args.id !== undefined && typeof args.id !== "string") return unreadable("id", args.id);
  if (args.how !== undefined && !(HOWS as readonly JsonValue[]).includes(args.how)) return unreadable("how", args.how, HOWS);
  const gists = args.how === "gist";
  const { tokens } = call.deps;
  /** What a gist answer closes with: how much it shows of how much, and the call that reads an item whole. */
  const gistLine = (shown: readonly JsonObject[], wholes: readonly JsonObject[]): void => {
    const first = shown.some((g) => g.first !== undefined);
    reply.line("gists", { items: shown.length, one: shown.length === 1, ...(first ? { first: true } : {}), ...(tokens !== undefined ? { shown: tokens(JSON.stringify(shown)), whole: tokens(JSON.stringify(wholes)) } : {}) });
  };

  const record = recordOr(call, reply);
  if (record === null) return reply;
  const clock = storyClock(call.deps.store, call.scope.user, call.scope.chat, call.scope.turn ?? null);
  const spans = allSpans(record);
  const history = args.history === true;

  if (typeof args.id === "string") {
    const item = record.items.get(args.id.trim());
    if (item === undefined) return reply.line("unknown_id", { id: JSON.stringify(args.id), ...(typeof part === "string" ? { part } : {}), ...nearIds(call.lines, call.settings, record, args.id, typeof part === "string" ? (part as StoryPart) : null) }).fail();
    const whole = itemView(record, item, clock, spans, history);
    if (!gists) return reply.data({ [item.part]: [whole] });
    const gist = gistView(whole, tokens);
    reply.data({ [item.part]: [gist] });
    gistLine([gist], [whole]);
    return reply;
  }
  if (args.due === true && clock === null) reply.line("no_clock_due", {});

  const from = typeof args.from === "number" ? args.from : 0;
  const to = typeof args.to === "number" ? args.to : Number.POSITIVE_INFINITY;
  const who = typeof args.who === "string" ? nameKey(args.who) : null;
  // A place asked by words is read as the world's own place where one goes by them; beats tied to its ref and beats that name it in words both match.
  const place = typeof args.place === "string" ? { words: nameKey(args.place), ref: placeRefOf(treeOf(call), args.place) ?? null } : null;
  // A quest asked by its name, id or ref is read as the quest of this world that goes by it; the beats that moved it are those tied to its ref or that name it in words.
  const quest = typeof args.quest === "string" ? { words: nameKey(args.quest), ref: questRefOf(treeOf(call).world.tracks, record.quests, args.quest) } : null;
  const matches: StoryItem[] = [];
  for (const p of part === undefined ? STORY_PARTS : [part as StoryPart]) {
    for (const item of record.of(p)) {
      if (place !== null && !(item.fields.place_ref === place.ref || nameKey(typeof item.fields.place === "string" ? item.fields.place : "") === place.words)) continue;
      if (quest !== null && !(Array.isArray(item.fields.quest_refs) ? item.fields.quest_refs.includes(quest.ref ?? "") : Array.isArray(item.fields.quests) && item.fields.quests.some((w) => typeof w === "string" && nameKey(w) === quest.words))) continue;
      if (args.open === true && (CLOSABLE[item.part] !== true || item.closedBy !== null)) continue;
      if (args.hot === true && !(item.part === "thread" && item.fields.hot === true)) continue;
      if (args.due === true) {
        const due = item.fields.due;
        if (item.part !== "future" || item.closedBy !== null || clock === null || typeof due !== "number" || due > clock.now) continue;
      }
      if (who !== null && !namesOf(item).some((n) => nameKey(n) === who)) continue;
      const [start, end] = placeOf(record, item, spans);
      if (end < from || start > to) continue;
      matches.push(item);
    }
  }
  if (matches.length === 0) return reply.line("none", {});
  const shown = matches.slice(0, call.settings.queryItems);
  const data: JsonObject = {};
  const wholes: JsonObject[] = [];
  const given: JsonObject[] = [];
  for (const item of shown) {
    const list = (data[item.part] ??= []) as JsonValue[];
    const whole = itemView(record, item, clock, spans, history);
    wholes.push(whole);
    const view = gists ? gistView(whole, tokens) : whole;
    given.push(view);
    list.push(view);
  }
  const now = args.due === true && clock !== null ? clock.text(clock.now) : null;
  if (now !== null) data.now = now;
  reply.data(data);
  if (gists) gistLine(given, wholes);
  const rest = matches.slice(shown.length);
  // What is left out is counted, and sized where a counter is given: an answer that is not the whole says how much it is of how much.
  if (rest.length > 0) reply.line("more", { count: rest.length, next: rest[0]?.id ?? "", ...(tokens !== undefined ? { tokens: tokens(JSON.stringify(rest.map((item) => itemView(record, item, clock, spans, history)))) } : {}) });
  return reply;
}

export const STORY_QUERY: StoryToolSpec = {
  name: "story_query",
  family: "story",
  tier: "read",
  properties: QUERY_PROPERTIES,
  required: [],
  example: { part: "thread", open: true, who: "Bram" },
  run: query,
};
