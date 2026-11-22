// Taking in a backlog (plan 3.2 §6.5). What a character has perceived and not taken in, and the old mind
// files it carried and has not filed, as work for its own agent: cut into batches, each a fixed range of
// perception ids, oldest first, whole, up to `cast.takeInTokens`, so that its agent can hand each batch to
// an instance of itself and two instances never hold the same perception. Three views of `cast:self(…)`:
//
//   take-in                                what waits: the batches by their names with their sizes, and the
//                                          files; where everything perceived fits one batch, that batch whole
//   unprocessed-perceptions[<from>..<to>]  one batch: the perceptions from one id to another, both included,
//                                          that are still not taken in
//   imported[<name>]                       one carried file, whole
//
// A range is by ids, which do not move: a perception taken in or struck since the plan was read is left out of
// its range, which keeps its ends all the same, and one written since comes after every range. Each perception
// is handed over as its character may read it and sized as that copy is (`zoom.ts`, `ownPerception`): what it
// missed and how reliable a telling was never come along, whatever a layout says. Code cuts by size and lays out
// what the record holds; it decides nothing about what a perception is worth.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import { type CastSettings, CAST_DEFAULTS, castClock, datedAt } from "./kit";
import { fileName, fileNamed, importedFiles, importedText, isFiled } from "./imported";
import { untakenPerceptions } from "./memory";
import { castAt } from "./path";
import { type CastItem, castingInForce, CastRecord, chatLine, findCharacter } from "./record";
import { worldAt } from "./secrets";
import { type CastViewInput, type Layout, mindsShown } from "./views";
import { type OwnReading, ownPerception, type Tokens, untakenSized } from "./zoom";

/** The view that lists what waits to be taken in, as work. */
export const TAKE_IN_VIEW = "take-in";
/** The prompt part that lays it out. */
export const TAKE_IN_PART = "cast-take-in";

const PERCEPTIONS = "unprocessed-perceptions";
const IMPORTED = "imported";

/** A view of `cast:self(…)` that takes an argument: a range of perceptions by their ids, or one carried file by its name. */
export type Argued = { view: typeof PERCEPTIONS; from: string; to: string } | { view: typeof IMPORTED; file: string };

const RANGE = /^unprocessed-perceptions\[\s*([^\s\]]+?)\s*\.\.\s*([^\s\]]+?)\s*\]$/;
const FILE = /^imported\[(.+)\]$/;

/** The view a name asks for with an argument; null for any other name. */
export function arguedView(name: string): Argued | null {
  const range = RANGE.exec(name);
  if (range?.[1] !== undefined && range[2] !== undefined) return { view: PERCEPTIONS, from: range[1], to: range[2] };
  const file = FILE.exec(name)?.[1]?.trim();
  return file !== undefined && file !== "" ? { view: IMPORTED, file } : null;
}

/** Whether a name is one of the views this module gives. */
export function isTakeInView(name: string): boolean {
  return name === TAKE_IN_VIEW || arguedView(name) !== null;
}

/** The name that opens a range of perceptions, as the plan writes it and `cast:self(…)` reads it. */
export function rangeName(from: string, to: string): string {
  return `${PERCEPTIONS}[${from}..${to}]`;
}

/** The name that opens one carried file. */
export function fileViewName(file: string): string {
  return `${IMPORTED}[${file}]`;
}

/** The names of a `cast:<who>(…)` list, one by one: a comma inside an argument's brackets is the argument's own. */
export function viewNames(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let now = "";
  for (const ch of list) {
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(now);
      now = "";
    } else now += ch;
  }
  out.push(now);
  return out.map((name) => name.trim()).filter((name) => name !== "");
}

/** A perception's size as its character's own agent is handed it (`ownPerception`), in tokens as the chat counts them: what a backlog is measured by wherever it is said. */
export function perceptionTokens(reading: Pick<OwnReading, "record" | "clock">, item: CastItem, tokens: Tokens): number {
  return tokens(JSON.stringify(ownPerception(reading, item)));
}

/** A perception that waits, with its size. */
export interface Sized {
  item: CastItem;
  tokens: number;
}

/** A batch of what waits: perceptions from one id to another, oldest first, and their size. */
export interface TakeInBatch {
  n: number;
  from: string;
  to: string;
  items: CastItem[];
  tokens: number;
}

/**
 * `untaken`, oldest first as given, each with its size, cut into batches of at most `most` tokens each: a batch holds one perception
 * at least, however large, and no perception is cut. The ranges do not overlap and leave none out.
 */
export function takeInBatches(untaken: readonly Sized[], most: number): TakeInBatch[] {
  const out: TakeInBatch[] = [];
  let items: CastItem[] = [];
  let size = 0;
  const close = (): void => {
    const [first] = items;
    const last = items.at(-1);
    if (first !== undefined && last !== undefined) out.push({ n: out.length + 1, from: first.id, to: last.id, items, tokens: size });
    items = [];
    size = 0;
  };
  for (const one of untaken) {
    if (items.length > 0 && size + one.tokens > most) close();
    items.push(one.item);
    size += one.tokens;
  }
  close();
  return out;
}

/** A carried file that waits to be filed: its name, and its size. */
export interface WaitingFile {
  file: string;
  tokens: number;
}

/** What waits for a character's own agent to take in, as work: the batches of what it perceived, and the files it carried. */
export interface TakeInPlan {
  batches: TakeInBatch[];
  files: WaitingFile[];
}

/** What waits for `character` at the reading, cut by the chat's setting. The older minds pack's notes count as one file, under their own name. */
export function takeInPlan(reading: Pick<OwnReading, "record" | "clock">, character: string, most: number, tokens: Tokens, text: (file: CastItem) => string | null): TakeInPlan {
  const files = importedFiles(reading.record, character)
    .filter((f) => !isFiled(f))
    .map((f): WaitingFile => ({ file: fileName(f), tokens: tokens(isRecord(f.fields.minds) ? JSON.stringify(f.fields.minds) : (text(f) ?? "")) }));
  return { batches: takeInBatches(untakenSized(reading, character, tokens), most), files };
}

/** A view this module gives, as laid out. */
export interface TakeInView {
  name: string;
  text: string;
}

/** The layouts the views are laid out by: the plan's own part, the perceptions' and the carried files'. One that is switched off gives its view no text. */
export interface TakeInLayouts {
  plan?: Layout;
  perceptions?: Layout;
  imported?: Layout;
}

type Fields = Record<string, JsonValue | undefined>;

/**
 * The views among `names` that this module gives, in the order named, of the character `input` names; none for a name of another
 * kind. A character the cast does not hold is given no text.
 */
export function takeInViews(names: readonly string[], input: Pick<CastViewInput, "store" | "user" | "chat" | "turn" | "job" | "character" | "tokens" | "settings">, layouts: TakeInLayouts): TakeInView[] {
  const asked = names.filter(isTakeInView);
  if (asked.length === 0) return [];
  const { db } = input.store;
  const user = input.store.user(input.user);
  const character = findCharacter(db, input.user, chatLine(user, input.chat), input.character);
  if (character === null) return asked.map((name) => ({ name, text: "" }));
  const record = CastRecord.read(input.store, input.user, castAt(user, input.chat, input.turn), input.job ?? null);
  const clock = castClock(input.store, input.user, input.chat, input.turn);
  const reading = { record, clock };
  const settings: CastSettings = { ...CAST_DEFAULTS, ...(input.settings ?? {}) };
  const casting = castingInForce(record, character);
  const head: Fields = { name: character.name, ...(casting !== null ? { casting: casting.as } : {}), ...(casting?.line != null ? { line: casting.line } : {}) };
  // Each perception as its character may read it, and nothing else of its row.
  const shown = (items: readonly CastItem[]): JsonObject[] => items.map((p) => ownPerception(reading, p));
  const listed = (items: JsonObject[]): { items: JsonObject[] } => ({ items: items.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, Array.isArray(value) ? { ".": value } : value]))) });
  const laid = (layout: Layout | undefined, fields: Fields): string => (layout === undefined ? "" : layout.render(fields).text.trimEnd());
  const waiting = importedFiles(record, character.id).filter((f) => !isFiled(f));
  const fileFields = (f: CastItem): Fields =>
    isRecord(f.fields.minds)
      ? { ...head, minds: mindsShown(f.fields.minds as JsonObject, worldAt(input.store, input.user, input.turn, input.job ?? null, input.chat), clock) }
      : { ...head, files: listed([{ file: fileName(f), text: importedText(db, input.user, f) ?? "" }]) };

  return asked.map((name): TakeInView => {
    const argued = arguedView(name);
    if (argued?.view === PERCEPTIONS) {
      // The perceptions between the two ids in the record's own order, both included, that are still not taken in. The ends are looked
      // for among every perception of the character, struck ones too: a range keeps its place when an end is struck after the plan was
      // read, and what is still untaken inside it is given all the same.
      const all = record.of(character.id, "perception", true);
      const [a, b] = [all.findIndex((p) => p.id === argued.from), all.findIndex((p) => p.id === argued.to)];
      const ids = a < 0 || b < 0 ? new Set<string>() : new Set(all.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id));
      const items = untakenPerceptions(record, character.id).filter((p) => ids.has(p.id));
      // A range with nothing left in it says so in the batch's own line, not as a character nothing has reached.
      return { name, text: laid(layouts.perceptions, items.length > 0 ? { ...head, batch: { from: argued.from, to: argued.to, count: items.length }, perceptions: listed(shown(items)) } : { ...head, batch: { from: argued.from, to: argued.to, done: true } }) };
    }
    if (argued?.view === IMPORTED) {
      const file = fileNamed(waiting, argued.file);
      return { name, text: laid(layouts.imported, file === undefined ? { ...head, none: true } : fileFields(file)) };
    }
    const plan = takeInPlan(reading, character.id, settings.takeInTokens, input.tokens, (f) => importedText(db, input.user, f));
    const perceptions = plan.batches.reduce((n, batch) => n + batch.items.length, 0);
    const dated = (item: CastItem | undefined): string | undefined => {
      const at = item === undefined ? {} : datedAt(clock, item.at);
      return "date" in at ? at.date : undefined;
    };
    const fields: Fields = {
      ...head,
      ...(plan.batches.length === 0 && plan.files.length === 0 ? { none: true } : {}),
      // More than one batch: each by the name that opens it, with its size. One: it is given whole, below.
      ...(plan.batches.length > 1
        ? {
            batches: {
              count: plan.batches.length,
              perceptions,
              tokens: plan.batches.reduce((n, batch) => n + batch.tokens, 0),
              most: settings.takeInTokens,
              items: plan.batches.map((batch) => {
                const [since, until] = [dated(batch.items[0]), dated(batch.items.at(-1))];
                return { n: batch.n, view: rangeName(batch.from, batch.to), count: batch.items.length, one: batch.items.length === 1, tokens: batch.tokens, ...(since !== undefined ? { since } : {}), ...(until !== undefined && until !== since ? { until } : {}) };
              }),
            },
          }
        : {}),
      ...(plan.batches.length === 1 ? { whole: { count: perceptions, one: perceptions === 1, tokens: plan.batches[0]?.tokens ?? 0 } } : {}),
      ...(plan.files.length > 0 ? { files: { count: plan.files.length, items: plan.files.map((f) => ({ file: f.file, view: fileViewName(f.file), tokens: f.tokens })) } } : {}),
    };
    const only = plan.batches.length === 1 ? plan.batches[0] : undefined;
    const whole = only === undefined ? "" : laid(layouts.perceptions, { ...head, perceptions: listed(shown(only.items)) });
    return { name, text: [laid(layouts.plan, fields), whole].filter((part) => part.trim() !== "").join("\n\n") };
  });
}
