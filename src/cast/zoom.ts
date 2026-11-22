// A character's record as the character itself may read it, and what each part of it weighs (plan 3.2 §6.4, §7.1). A character's own
// agent starts with a small standing self and an outline of the rest, and opens the rest a call at a time (`self_read`). Whatever it
// is handed of its own record beyond that standing self is made here, in one place:
//   - each entry as the character may know it. A perception is made from the fields that reached the character and from nothing
//     else (`ownPerception`): what it missed, how reliable a telling was, why the Author corrected or struck it, the ids of the
//     secrets it gave and anything a row gains later are the omniscient side's account, and are never copied. So no layout, tool,
//     outline or reader of the character's can show them, whatever its words; `cast_query` is the omniscient side's;
//   - each entry's size, in tokens as the chat counts them: the host hands the count in, the cast keeps none of its own;
//   - each entry by its gist (plan §7.1): a field the record holds, never a sentence made here; where the record holds none, the
//     text itself where it is one line, else its first line that holds words, marked as no gist;
//   - how much of a backlog a start holds whole, and the outline of what it does not, laid out by its part within its size.
// Code counts, sizes and picks by the record's own marks and order. It writes no word of its own, and judges nothing.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { ReadContext } from "../engine/registry";
import { isRecord } from "../shared/json";
import type { Store } from "../store";
import { beatsAt } from "./beats";
import type { SceneNamed } from "./facts";
import { gameSide } from "./game";
import { fileName, importedFiles, importedText, isFiled } from "./imported";
import { type CastClock, datedAt } from "./kit";
import { untakenPerceptions } from "./memory";
import { perceivedTurn } from "./perceive";
import { awayItemId, type CastItem, type CastRecord, type Character, RELATIONSHIP_DIMENSIONS } from "./record";
import { towardName } from "./refs";
import type { Layout } from "./views";

/** A text's tokens as the chat counts them: the host's count (the turn's, at the chat's characters to a token), handed in. */
export type Tokens = (text: string) => number;

/** Fields of a layout. */
type Fields = Record<string, JsonValue | undefined>;

/** What a character's own reads are made from: where the reading stands, the record there, and story time. */
export interface OwnReading {
  store: Store;
  /** The user's id. */
  user: string;
  chat: string;
  /** The chat, then each chat it was branched from: whose characters the reading knows. */
  chats: readonly string[];
  /** The turn read at; null at the chat's head. */
  turn: string | null;
  /** The job the reader works in, if it works in one: what that job wrote is read at once. */
  job: string | null;
  record: CastRecord;
  clock: CastClock | null;
}

// ---------------------------------------------------------------- what the character may read

/** What of a perception reached its character: the moment, how much of it, what reached their senses, what they came to know by it, and who told them. */
const PERCEIVED = ["moment", "reach", "content", "knows", "told_by"] as const;

/**
 * A perception as its character may read it: its id, the fields of `PERCEIVED` it holds, the reply it is of by its number on the path
 * (null: this turn's, not saved yet) and its date in story time. It is made field by field, so nothing else the row holds comes
 * along: not what the character missed, not how reliable a telling was, not why it was corrected, not a secret's id.
 */
export function ownPerception(reading: Pick<OwnReading, "record" | "clock">, item: CastItem): JsonObject {
  const out: JsonObject = { id: item.id };
  for (const field of PERCEIVED) {
    const value = item.fields[field];
    if (value !== undefined) out[field] = value;
  }
  out.message = reading.record.at.replyOf(perceivedTurn(item));
  return { ...out, ...datedAt(reading.clock, item.at) };
}

/** One perception a character holds and has not taken in, with what the character may read of it and its size. */
export interface OwnPerception {
  item: CastItem;
  /** The perception as its character may read it (`ownPerception`). */
  view: JsonObject;
  /** The size of `view` whole, in tokens as the chat counts them. */
  tokens: number;
}

/**
 * A character's perceptions not yet taken in (`untakenPerceptions`), oldest first, each as the character may read it and with its
 * size in tokens as `tokens` counts: what a start, the outline, `self_read` and a batch of a take-in measure a backlog by. It only
 * lists and sizes; every one of them stays whole, and stays untaken until its character's own agent takes it in.
 */
export function untakenSized(reading: Pick<OwnReading, "record" | "clock">, character: string, tokens: Tokens): OwnPerception[] {
  return untakenPerceptions(reading.record, character).map((item) => {
    const view = ownPerception(reading, item);
    return { item, view, tokens: tokens(JSON.stringify(view)) };
  });
}

/**
 * How many of the newest of `count` things a start holds whole within `most` tokens, where `sizeAt(k)` is the size of what is handed
 * over with the newest `k` whole and the others counted: every one where `most` is null or all of them fit; else as many as fit,
 * found by halving (holding one more never takes less room), none where not even the newest does. Nothing is cut to fit: what is not
 * held whole waits whole.
 */
export function newestWithin(count: number, most: number | null, sizeAt: (k: number) => number): number {
  if (most === null || sizeAt(count) <= most) return count;
  let lo = 0;
  let hi = Math.max(0, count - 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (sizeAt(mid) <= most) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A relationship as the character holds it: toward whom, by the name they go by now, in its own words, with the dimensions written. */
export function ownRelationship(reading: OwnReading, ctx: ReadContext | null, item: CastItem): JsonObject {
  const out: JsonObject = { id: item.id, with: towardName(reading.store.db, reading.user, reading.chats, ctx, item) ?? "" };
  if (typeof item.fields.text === "string") out.text = item.fields.text;
  for (const dimension of RELATIONSHIP_DIMENSIONS) {
    const value = item.fields[dimension];
    if (typeof value === "number") out[dimension] = value;
  }
  return out;
}

/** What of a statement of knowledge is the character's own: the statement, who told them, how they came by it in words, and what it is about. */
const KNOWN = ["text", "told_by", "how", "about"] as const;

/**
 * What a character knows, as statements: each knowledge row that holds words, oldest first, with the fields of `KNOWN` it holds and
 * its date. A row that only gives a secret holds no words of its own: the secrets a character holds reach it through the lore, by
 * the lore's own rule of which holdings count, and are none of this.
 */
export function ownKnowledge(reading: Pick<OwnReading, "record" | "clock">, character: string): JsonObject[] {
  return reading.record.of(character, "knowledge").flatMap((row): JsonObject[] => {
    if (typeof row.fields.text !== "string") return [];
    const out: JsonObject = { id: row.id };
    for (const field of KNOWN) {
      const value = row.fields[field];
      if (value !== undefined) out[field] = value;
    }
    return [{ ...out, ...datedAt(reading.clock, row.at) }];
  });
}

/** A character's history as the Author recorded it, oldest first: each entry's words, its date, and the words the story record has for when each beat it is linked to happened. */
export function ownHistory(reading: OwnReading, character: string): JsonObject[] {
  const beats = new Map((beatsAt(reading.store, reading.user, reading.record.at, reading.job) ?? []).map((beat) => [beat.id, beat.time]));
  return reading.record.of(character, "history").map((entry) => {
    const when = (Array.isArray(entry.fields.beats) ? entry.fields.beats : []).flatMap((id) => {
      const time = typeof id === "string" ? beats.get(id) : undefined;
      return typeof time === "string" ? [time] : [];
    });
    return { id: entry.id, ...(typeof entry.fields.text === "string" ? { text: entry.fields.text } : {}), ...(when.length > 0 ? { when } : {}), ...datedAt(reading.clock, entry.at) };
  });
}

/** An old mind file a character carried over and that is not yet filed. */
export interface OwnFile {
  item: CastItem;
  /** Its name, as the earlier build named it (`core.md`); `minds` for the notes the older minds pack kept. */
  file: string;
  /** Its text, word for word; null for the older minds pack's notes, which the state keeps as data (`item.fields.minds`). */
  text: string | null;
  /** Its size in tokens: of its text, or of the notes as the state keeps them. */
  tokens: number;
}

/** A character's old mind files not yet filed, in the order they were carried, the older minds pack's notes last, each with its size. */
export function filesWaiting(reading: Pick<OwnReading, "store" | "user" | "record">, character: string, tokens: Tokens): OwnFile[] {
  const waiting = importedFiles(reading.record, character).filter((file) => !isFiled(file));
  const texts = waiting.flatMap((item): OwnFile[] => {
    if (isRecord(item.fields.minds)) return [];
    const text = importedText(reading.store.db, reading.user, item) ?? "";
    return [{ item, file: fileName(item), text, tokens: tokens(text) }];
  });
  const notes = waiting.flatMap((item): OwnFile[] => (isRecord(item.fields.minds) ? [{ item, file: fileName(item), text: null, tokens: tokens(JSON.stringify(item.fields.minds)) }] : []));
  return [...texts, ...notes.slice(0, 1)];
}

/** Old mind files as a list lays them out, by name and size (the `imported-outline` view's form, and the same wherever files are listed and not shown): each file, and the older minds pack's notes as one more. */
export function filesListed(files: readonly OwnFile[]): { files?: { items: JsonObject[] }; minds?: { tokens: number } } {
  const named = files.flatMap((file): JsonObject[] => (file.text === null ? [] : [{ file: file.file, tokens: file.tokens }]));
  const notes = files.find((file) => file.text === null);
  return { ...(named.length > 0 ? { files: { items: named } } : {}), ...(notes !== undefined ? { minds: { tokens: notes.tokens } } : {}) };
}

/**
 * A character's game side as its layout takes it: the world's person it is, as the world state holds them (`game.ts`), and, for a
 * principal out of view, where it is, what it means to do and by when, as the Author recorded them. Null where the world holds no
 * person it is and nothing is recorded of it away.
 */
export function sideFields(reading: OwnReading, character: Character): Record<string, JsonValue> | null {
  const side = gameSide(reading.store, reading.user, reading.chat, reading.turn, character);
  const gone = reading.record.items.get(awayItemId(character.id));
  const away = gone === undefined || gone.dropped ? {} : Object.fromEntries(["whereabouts", "intention", "until"].flatMap((key) => (typeof gone.fields[key] === "string" ? [[key, gone.fields[key] as string]] : [])));
  const there = Object.keys(away).length > 0;
  return side === null && !there ? null : { ...(side ?? {}), ...(there ? { away } : {}) };
}

// ---------------------------------------------------------------- what a layout shows

/**
 * Whether a layout shows a field: its text changes when the field alone is added. A layout of the user's own that has no line for a
 * field is given the view as it was before the field existed, whole, so that nothing is counted in a line nobody reads.
 */
export function shows(layout: Layout, head: Fields, field: string, sample: JsonValue): boolean {
  return layout.render({ ...head, [field]: sample }).text !== layout.render(head).text;
}

/**
 * The size of entries whole, together: each one's own (its JSON, in tokens as the chat counts them), added up, so that a line that
 * counts some of them and a line that counts all of them agree, in an outline and in an answer alike. Nothing where no counter is given.
 */
export function sizeOf(wholes: readonly JsonValue[], tokens: Tokens | undefined): number | undefined {
  return tokens === undefined ? undefined : wholes.reduce<number>((sum, whole) => sum + tokens(JSON.stringify(whole)), 0);
}

/** How many things a line counts, whether it is one, and their size together. */
function counted(sizes: readonly number[]): { count: number; one: boolean; tokens: number } {
  return { count: sizes.length, one: sizes.length === 1, tokens: sizes.reduce((sum, size) => sum + size, 0) };
}

/** The sections of a game side that can be large: what is on the person, what they own that is kept elsewhere, and the values the state keeps of them. */
const SIDE_SECTIONS = ["holds", "owns", "values"] as const;
type SideSection = (typeof SIDE_SECTIONS)[number];

/** A sample of each section's folded form, to ask a layout whether it shows one. */
const FOLDED_SAMPLES: Readonly<Record<SideSection, JsonObject>> = { holds: { count: 1, one: true, names: "a", tokens: 1 }, owns: { count: 1, one: true, tokens: 1 }, values: { count: 1, one: true, tokens: 1 } };

/** The items a section of a game side lists. */
function sideItems(side: Readonly<Record<string, JsonValue>>, section: SideSection): JsonObject[] {
  const listed = side[section];
  return isRecord(listed) && Array.isArray(listed.items) ? listed.items.filter((item): item is JsonObject => isRecord(item)) : [];
}

/**
 * A game side with its large sections closed (plan 3.2 §6.4), as the world state closes a thing that holds much: a section whose
 * printed lines pass `most` tokens (`worldState.foldTokens`) is given under `folded` in its place, what is on the person by name and
 * the other two by count, each with the size of what is not shown. A section the layout shows no folded form of stays whole.
 */
export function foldedSide(side: Readonly<Record<string, JsonValue>>, layout: Layout, most: number, tokens: Tokens): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = { ...side };
  const folded: JsonObject = {};
  for (const section of SIDE_SECTIONS) {
    const items = sideItems(side, section);
    if (items.length === 0) continue;
    const size = tokens(layout.render({ [section]: side[section] }).text.trim());
    if (size <= most || !shows(layout, {}, "folded", { [section]: FOLDED_SAMPLES[section] })) continue;
    delete out[section];
    folded[section] = { count: items.length, one: items.length === 1, tokens: size, ...(section === "holds" ? { names: items.map((item) => String(item.name ?? "")).join(", ") } : {}) };
  }
  return Object.keys(folded).length === 0 ? out : { ...out, folded };
}

/** A game side as an answer gives it: the layout's fields as plain data, a list as a list. */
export function sideData(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sideData);
  if (!isRecord(value)) return value;
  if (Object.hasOwn(value, ".")) return sideData(value["."] as JsonValue);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "items" && Array.isArray(value.items)) return value.items.map(sideData);
  return Object.fromEntries(keys.map((key) => [key, sideData(value[key] as JsonValue)]));
}

/** A game side by name and count, as an answer gives it by gist: where they are, what is on them by name, and how many things they own elsewhere and values the state keeps, each with its size where a count is given. */
export function sideGist(side: Readonly<Record<string, JsonValue>>, tokens: Tokens | undefined): JsonObject {
  const out: JsonObject = {};
  for (const key of ["ref", "where", "away"]) if (side[key] !== undefined) out[key] = sideData(side[key] as JsonValue);
  const on = sideItems(side, "holds");
  if (on.length > 0) out.on = on.map((item) => String(item.name ?? ""));
  for (const section of ["owns", "values"] as const) {
    const items = sideItems(side, section);
    if (items.length > 0) out[section] = { count: items.length, ...(tokens !== undefined ? { tokens: tokens(JSON.stringify(sideData(items))) } : {}) };
  }
  return out;
}

// ---------------------------------------------------------------- gists

/** The first line of a text that holds words, trimmed; none where no line does. */
export function firstLine(text: string): string | undefined {
  return text.split("\n").find((line) => /[\p{L}\p{N}]/u.test(line))?.trim();
}

/** What stands for an entry of one part of a record: the field that holds its gist, where the part has one; the field that holds its text; and the fields that say which entry it is. */
export interface GistOf {
  gist?: string;
  text: string;
  keep: readonly string[];
}

/** Each part's gist: a memory's is the gist its own agent wrote, a perception's the lines of what its character came to know by it, a carried file's the summary the older minds pack kept; the other parts hold none. */
export const GISTS = {
  perception: { gist: "knows", text: "content", keep: ["moment", "date", "message", "dropped"] },
  memory: { gist: "gist", text: "text", keep: ["tier", "faint", "date"] },
  relationship: { text: "text", keep: ["with", ...RELATIONSHIP_DIMENSIONS, "dropped"] },
  knowledge: { text: "text", keep: ["date", "kept_in", "dropped"] },
  history: { text: "text", keep: ["date", "dropped"] },
  growth: { text: "text", keep: ["date", "proposed", "dropped"] },
  mind: { text: "text", keep: ["kind", "file", "filed", "dropped"] },
  away: { text: "whereabouts", keep: ["until", "dropped"] },
  file: { gist: "summary", text: "text", keep: ["file"] },
  base: { text: "text", keep: ["version", "by"] },
  held: { text: "text", keep: ["fact", "kept_in"] },
} as const satisfies Record<string, GistOf>;

/** Whether a value holds words: a text that is not blank, or a list with one. */
function holdsWords(value: JsonValue | undefined): boolean {
  return typeof value === "string" ? value.trim() !== "" : Array.isArray(value) && value.some((one) => typeof one === "string" && one.trim() !== "");
}

/**
 * An entry by its gist, from the entry whole (plan 3.2 §7.1): its id, the fields that say which entry it is, and what the record holds
 * that stands for it. Where the record holds no gist of it, its text as it is where that is one line, else the first line of its text
 * that holds words (`first`), which is no gist of anyone's writing: the answer's line says so. With a counter, `tokens` is the size of
 * the entry whole.
 */
export function gistOf(spec: GistOf, whole: JsonObject, tokens: Tokens | undefined): JsonObject {
  const out: JsonObject = {};
  if (whole.id !== undefined) out.id = whole.id;
  for (const key of spec.keep) {
    const value = whole[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  const held = spec.gist === undefined ? undefined : whole[spec.gist];
  const text = whole[spec.text];
  if (spec.gist !== undefined && holdsWords(held)) out[spec.gist] = held as JsonValue;
  else if (typeof text === "string" && text.trim() !== "") {
    if (text.trim().includes("\n")) out.first = firstLine(text) ?? "";
    else out[spec.text] = text.trim();
  }
  if (tokens !== undefined) out.tokens = tokens(JSON.stringify(whole));
  return out;
}

// ---------------------------------------------------------------- the outline

/** What the outline of a character's record is made from. */
export interface OutlineOf {
  /** The layout's opening fields: the character's name and casting. */
  head: Fields;
  /** What the same start does not hold whole of what the character perceived and has not taken in, oldest first. */
  earlier: readonly OwnPerception[];
  /** What it does hold whole of them: the newest. A line's call is narrowed (`to`) so that it brings none of these again. */
  held: readonly OwnPerception[];
  /** Story time as the reading shows it, for the day each perception is laid out under; null: none is. */
  clock: CastClock | null;
  /** The scene each turn lies in (null: none), as the host read it from the story record; a turn it does not hold is in none. */
  sceneOf: ReadonlyMap<string, SceneNamed | null>;
  /** Each memory's tier and its size. */
  memories: readonly { tier: "top" | "short" | "long"; tokens: number }[];
  /** Each person not here the character holds a relationship toward, by the name they go by now, with its size. */
  absent: readonly { who: string; tokens: number }[];
  /** The size of each statement of what the character knows. */
  knowledge: readonly number[];
  /** The size of each entry of its history. */
  history: readonly number[];
  /** Its old mind files not yet filed; none where the `imported` view beside the outline shows or lists them. */
  files: readonly OwnFile[];
  layout: Layout;
  /** Tokens the outline may fill (`cast.outlineTokens`). */
  most: number;
  tokens: Tokens;
}

interface SceneNode {
  scene: SceneNamed;
  leaves: OwnPerception[];
}

interface DayNode {
  day: string | null;
  scenes: SceneNode[];
  /** Its perceptions of turns in no scene. */
  loose: OwnPerception[];
  all: OwnPerception[];
}

/** The day a perception is laid out under, as the reading shows story time; null: it has no date, or none is shown. */
function dayOf(clock: CastClock | null, p: OwnPerception): string | null {
  return p.item.at === null || clock === null ? null : clock.day(p.item.at);
}

/**
 * A perception as a line of the outline: its id, its size, the moment as it is named, and the lines of what its character came to
 * know by it. Nothing of what reached them is put in a line: that is read whole, and a line stays a line however long it was.
 */
function leafOf(p: OwnPerception): JsonObject {
  const knows = Array.isArray(p.view.knows) ? p.view.knows.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
  const moment = typeof p.view.moment === "string" ? p.view.moment.trim() : "";
  // A list an item holds is put in as an object's own value (`.`), so that a block on it shows once and its name puts it in joined.
  return { id: p.item.id, tokens: p.tokens, ...(moment !== "" ? { moment } : {}), ...(knows.length > 0 ? { knows: { ".": knows } } : {}) };
}

/**
 * The outline of a character's record (plan 3.2 §6.4) as its layout takes it: one line for each part, with how many it holds and how
 * large that is, and, of what it perceived earlier and has not taken in, the days, then the scenes within them, then each perception
 * by the lines of what it came to know, the newest first, as far as `most` tokens hold. What is not listed is counted in the line
 * above it: a perception in its scene's or its day's, a scene in its day's, a day in the line of them all. Listing one more never
 * takes less room, so how many fit is found by halving; the one line for each part stands whatever the size. A line's call brings
 * what the line counts and no more: where the start holds newer perceptions whole, the calls that would bring them too end at the
 * last that waits (`to`). Null with nothing to outline.
 */
export function outlineFields(of: OutlineOf): Fields | null {
  const days: DayNode[] = [];
  // The last perception that waits: a call that reads up to it brings none of those the start holds whole.
  const last = of.held.length > 0 ? of.earlier.at(-1)?.item.id : undefined;
  const heldOn = new Set(of.held.map((p) => dayOf(of.clock, p)));
  for (const p of of.earlier) {
    const day = dayOf(of.clock, p);
    let node = days.find((d) => d.day === day);
    if (node === undefined) days.push((node = { day, scenes: [], loose: [], all: [] }));
    node.all.push(p);
    const scene = of.sceneOf.get(perceivedTurn(p.item)) ?? null;
    if (scene === null) {
      node.loose.push(p);
      continue;
    }
    let held = node.scenes.find((s) => s.scene.id === scene.id);
    if (held === undefined) node.scenes.push((held = { scene, leaves: [] }));
    held.leaves.push(p);
  }
  // What may be listed, in the order it is given room: the people not here by name, then the days, the scenes and the perceptions, each the newest first.
  const scenes = days.flatMap((d) => d.scenes);
  const order: (string | DayNode | SceneNode | OwnPerception)[] = [...of.absent.map((a) => a.who), ...[...days].reverse(), ...[...scenes].reverse(), ...[...of.earlier].reverse()];
  const sizes = (list: readonly OwnPerception[]): number[] => list.map((p) => p.tokens);
  const tiers = (["top", "short", "long"] as const).flatMap((tier) => {
    const held = of.memories.filter((m) => m.tier === tier);
    return held.length === 0 ? [] : [[tier, counted(held.map((m) => m.tokens))] as const];
  });
  const fixed: Fields = {
    ...(of.memories.length > 0 ? { memories: { ...counted(of.memories.map((m) => m.tokens)), ...Object.fromEntries(tiers) } } : {}),
    ...(of.knowledge.length > 0 ? { knowledge: counted(of.knowledge) } : {}),
    ...(of.history.length > 0 ? { history: counted(of.history) } : {}),
    ...(of.files.length > 0 ? { imported: { ...counted(of.files.map((f) => f.tokens)), ...filesListed(of.files) } } : {}),
  };
  if (of.earlier.length === 0 && of.absent.length === 0 && Object.keys(fixed).length === 0) return null;
  const laid = (k: number): Fields => {
    const listed = new Set(order.slice(0, k));
    const lines = (list: readonly OwnPerception[]): JsonObject[] => list.filter((p) => listed.has(p)).map(leafOf);
    const shown = days.filter((d) => listed.has(d));
    const older = days.filter((d) => !listed.has(d)).flatMap((d) => d.all);
    // The days not listed are read by the id that ends them, where they are the oldest of what waits one after another.
    const upTo = older.length > 0 && older.every((p, i) => p === of.earlier[i]) ? older.at(-1)?.item.id : undefined;
    const dayLines = shown.map((d): JsonObject => {
      const within = d.scenes
        .filter((s) => listed.has(s))
        .map((s): JsonObject => {
          const items = lines(s.leaves);
          return { id: s.scene.id, ...(s.scene.title !== null ? { title: s.scene.title } : {}), ...counted(sizes(s.leaves)), ...(items.length > 0 ? { items } : {}) };
        });
      const loose = lines(d.loose);
      return { ...(d.day !== null ? { day: d.day } : {}), ...counted(sizes(d.all)), ...(last !== undefined && heldOn.has(d.day) ? { to: last } : {}), ...(within.length > 0 ? { scenes: { items: within } } : {}), ...(loose.length > 0 ? { loose: { items: loose } } : {}) };
    });
    const who = of.absent.filter((a) => listed.has(a.who)).map((a): JsonObject => ({ who: a.who, tokens: a.tokens }));
    return {
      ...of.head,
      ...(of.earlier.length > 0
        ? {
            perceived: {
              ...counted(sizes(of.earlier)),
              // `earlier` where newer ones are held whole beside the outline: with none held, those that wait are all there is.
              ...(of.held.length > 0 ? { earlier: true } : {}),
              ...(last !== undefined ? { to: last } : {}),
              ...(shown.length > 0 && older.length > 0 ? { older: { ...counted(sizes(older)), ...(upTo !== undefined ? { to: upTo } : {}) } } : {}),
              ...(dayLines.length > 0 ? { days: { items: dayLines } } : {}),
            },
          }
        : {}),
      ...fixed,
      ...(of.absent.length > 0 ? { absent: { ...counted(of.absent.map((a) => a.tokens)), ...(who.length > 0 ? { who: { items: who } } : {}) } } : {}),
    };
  };
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (of.tokens(of.layout.render(laid(mid)).text.trimEnd()) <= of.most) lo = mid;
    else hi = mid - 1;
  }
  return laid(lo);
}
