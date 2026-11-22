// The lore map the Author is given at the start of every turn (plan §9.2; plan 3.2 §6.2, §7.1), in five parts:
//   1. in the prompt: each entry that activated, with what the index says it is and defines, how it
//      stands against the turn before (new, changed, as it was) and what the lead did with it then;
//   2. changed by the story: those of them the story has since outdated, with the overlays' notes;
//   3. from the world's own lore: world entries whose keys come up in the recent messages;
//   4. bound to the horizon: entries bound to who and what is on the horizon that did not activate,
//      the player's character's first, then each character present's, then the place's, up to a limit,
//      with a count of any left out;
//   5. gone: what the prompt of the turn before held that this one does not.
// An entry no run has indexed as it stands shows its keys. Every line says the size of what it names,
// where the asker counts. The map is made from ids, keys, bindings and what each turn's prompt held;
// nothing in it is ranked or judged by code. Its layout is the shipped prompt part
// `.prompts/lore-map.md`, and each entry's line is a line of `.prompts/lore-answers.md`; these are the
// fields they lay out. `Lore.loreMap` gives the first form, parts 1 and 3 by id and title alone; how an
// entry stands against the turn before is the turn lane's to say (`turn/lore-kept.ts`).

import type { Fields, LinesPart } from "../app/guidance";
import type { ActivatedLore, JsonObject } from "rp-harness/contract";
import type { LoreBinding, LoreNamedFields } from "./indexing";
import type { OverlayNote } from "./overlays";
import { listField, loreLine, namedFields } from "./tools";

/** One entry of the map. */
export interface LoreMapLine {
  id: string;
  title: string;
  /** For an entry that activated: its book's name, '' where the book cannot be read. */
  source?: string;
  /** For an entry that activated: how, in the lore's own four words (`lore.ts` `HOWS`); absent where Lumiverse did not say. Part 1's lines say it. */
  how?: ActivatedLore["how"];
  /** What the index says it is, where a run or the user has said. */
  kind?: string;
  line?: string;
  defines?: LoreBinding[];
  /** For an entry no run has indexed as it stands: its keys, which stand in for what it is. */
  keys?: string[];
  /** For an entry indexed at an earlier revision: what it was indexed as shows, marked as changed since (never with its keys, which stand in for what an entry no run has indexed is). */
  stale?: boolean;
  /** The fields beside kind, line and defines that the indexer's file asks an index line to hold, by name. */
  fields?: LoreNamedFields;
  /** The overlays' notes on it, oldest first, each with the turn it was written on: on an entry the story has moved past, in whichever part it is shown. */
  notes?: OverlayNote[];
  /** Bound to the horizon: the names of who and what on it the entry is bound to. */
  bound?: string[];
  /** The secrets it holds, each by the id a perception names and who holds it. */
  secrets?: { id: string; holders: string[] }[];
  /** Its size in tokens: for an entry that activated, of its text as the prompt carried it; for another, of its text as the lore holds it. Absent where nobody counted. */
  tokens?: number;
  /** For an entry that activated: how it stands against the prompt of the turn before (plan 3.2 §6.1); absent where that prompt is not kept. */
  status?: "new" | "changed" | "same";
  /** For an entry the prompt of the turn before held too: whether the lead kept it whole then, or let it go; absent where that is not known. */
  before?: "kept" | "let_go";
  /** It starts this turn let go, as its one line: the lead let it go last turn, its text stands, and the user lets that choice stand (`lore.choiceStands`). */
  letGo?: boolean;
}

export interface LoreMap {
  /** The entries Lumiverse activated for this turn's prompt, in the order it gave them. */
  inPrompt: LoreMapLine[];
  /** The world's own entries whose keys come up in the recent messages, in the world's order. They are never in Lumiverse's prompt. */
  world: LoreMapLine[];
  /** Activated entries the story has since outdated, each with its notes. Absent from the first form. */
  changed?: LoreMapLine[];
  /** Entries bound to who and what is on the horizon that did not activate, up to the limit. Absent from the first form. */
  bound?: LoreMapLine[];
  /** How many more entries were bound to the horizon than the limit let in. */
  leftOut?: number;
  /** How many entries of the chat's lore no run has indexed as they stand. */
  notIndexed?: number;
  /** Entries the prompt of the turn before held that this turn's does not, each by its id, its title and its size. Absent from the first form. */
  gone?: LoreMapLine[];
}

/**
 * A part of the map as the layout `.prompts/lore-map.md` takes it. With the lore's lines in force, `lines`: each entry's line as a line of
 * that part words it. With them off, `entries`: each entry's own fields, which the layout lays out itself (no line is made in code).
 */
export type LoreMapPart = {
  lines?: string[];
  entries?: JsonObject[];
};

/** The fields of `.prompts/lore-map.md` the map fills. A part with no entries is left out, so the layout shows nothing of it. */
export interface LoreMapFields {
  in_prompt?: LoreMapPart;
  changed?: LoreMapPart;
  world?: LoreMapPart;
  bound?: LoreMapPart & { left_out?: number };
  gone?: LoreMapPart;
  not_indexed?: number;
}

/** An entry's fields as the map's lines, or the layout itself, read them. */
function lineFields(lines: LinesPart | undefined, l: LoreMapLine): Fields {
  return {
    ...namedFields(l.fields),
    id: l.id,
    title: l.title,
    kind: l.kind,
    line: l.line,
    defines: listField((l.defines ?? []).map((b) => (lines === undefined ? undefined : loreLine(lines, "binding", { what: b.what, aspect: b.aspect })) ?? b.what)),
    keys: l.keys === undefined ? undefined : listField(l.keys),
    // Each note beside the turn it was written on: a line reads the note as `{{.}}` or `{{note}}` and the turn as `{{turn}}`.
    notes: l.notes?.map((n) => ({ ".": n.note, note: n.note, turn: n.turn })),
    // Each secret it holds, by the id a perception names and who holds it: a line reads them as `{{#secrets}}{{id}} held by {{holders}}{{/secrets}}`.
    secrets: l.secrets?.map((s) => ({ id: s.id, holders: listField(s.holders) })),
    bound: listField(l.bound ?? []),
    // How an entry came into the prompt: the word, and a flag for each of the four, so a line can word each its own way.
    how: l.how,
    how_constant: l.how === "constant" ? true : undefined,
    how_keyword: l.how === "keyword" ? true : undefined,
    how_vector: l.how === "vector" ? true : undefined,
    how_sticky: l.how === "sticky" ? true : undefined,
    stale: l.stale,
    tokens: l.tokens,
    // How it stands against the turn before, a flag for each, and what the lead did with it then.
    is_new: l.status === "new" ? true : undefined,
    is_changed: l.status === "changed" ? true : undefined,
    is_same: l.status === "same" ? true : undefined,
    kept_last_turn: l.before === "kept" ? true : undefined,
    let_go_last_turn: l.before === "let_go" ? true : undefined,
    starts_let_go: l.letGo === true ? true : undefined,
  };
}

/** Each field of an entry that has a value, as the layout reads an entry. */
function entryOf(fields: Fields): JsonObject {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as JsonObject;
}

/**
 * The map's fields. With the lore's lines in force for the chat, each entry's line is that part's line
 * for it (`map_in_prompt`, `map_changed`, `map_world`, `map_bound`, `map_gone`); without them, each part carries its
 * entries' fields and `lore-map.md` lays out each entry itself.
 */
export function loreMapFields(map: LoreMap, lines?: LinesPart): LoreMapFields {
  const part = (entries: readonly LoreMapLine[] | undefined, name: string): LoreMapPart => {
    const list = entries ?? [];
    return lines === undefined ? { entries: list.map((l) => entryOf(lineFields(undefined, l))) } : { lines: list.flatMap((l) => loreLine(lines, name, lineFields(lines, l)) ?? []) };
  };
  const shown = (p: LoreMapPart): boolean => (p.lines ?? p.entries ?? []).length > 0;
  const inPrompt = part(map.inPrompt, "map_in_prompt");
  const changed = part(map.changed, "map_changed");
  const world = part(map.world, "map_world");
  const bound = part(map.bound, "map_bound");
  const gone = part(map.gone, "map_gone");
  const leftOut = map.leftOut ?? 0;
  return {
    ...(shown(inPrompt) ? { in_prompt: inPrompt } : {}),
    ...(shown(changed) ? { changed } : {}),
    ...(shown(world) ? { world } : {}),
    ...(shown(bound) || leftOut > 0 ? { bound: { ...bound, ...(leftOut > 0 ? { left_out: leftOut } : {}) } } : {}),
    ...(shown(gone) ? { gone } : {}),
    ...((map.notIndexed ?? 0) > 0 ? { not_indexed: map.notIndexed } : {}),
  };
}
