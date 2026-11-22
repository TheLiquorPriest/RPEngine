// The lore a scene's prompts have held, turn against turn (plan 3.2 §6.1, §6.2). What a turn's prompt held of
// the lore is kept with the turn: each entry with the hash and the size of its text as the prompt carried it
// (after RPE's check of the lore on receipt, so what secrecy took out or worded otherwise is never here as it
// was written), and with it the scene's list so far, every entry a prompt of the session held on this turn's
// path. A turn is compared with the turn before it on its path: an entry is new, changed, as it was, or gone.
// What the lead did with an entry (kept it whole, or let it go) is read from the trace the turn before kept
// of its run, where the lead's `window` calls are records.
//
// Code compares and lists. It lets nothing go: with `lore.choiceStands` on, the names of the entries the lead
// itself let go last turn, whose text stands, are handed to RPH (`TurnRequest.letGo`), which starts the turn
// with them as their lines and brings each back whole when the lead asks.
//
// Nothing here reads or writes: the lane does both (`turns.ts`), and `ACTIVATED-LORE.md` is laid out by the
// prompt part `.prompts/activated-lore.md` from the fields `sceneFields` gives.

import { createHash } from "node:crypto";
import type { JsonObject, TraceRecord } from "rp-harness/contract";
import type { Fields } from "../app/guidance";
import { isRecord } from "../shared/json";

/** The file in a session's cache folder that lists the lore its scene's prompts have held (plan 3.2 §6.2). RPE's own: RPH lists it to the lead as a file of the host's. */
export const ACTIVATED_LORE_FILE = "ACTIVATED-LORE.md";

/** The prompt part that file is laid out by. */
export const ACTIVATED_LORE_PART = "activated-lore";

/** A session's cache folder below the session's own, as RPH names it. */
export const SESSION_CACHE = "cache/";

/** How an entry of a turn's prompt stands against the prompt of the turn before it on the path. */
export type LoreStatus = "new" | "changed" | "same";

/** What the lead did with an entry by the end of a turn's run: kept it whole, or let it go. */
export type LeadChoice = "kept" | "let_go";

/** An entry as a turn's prompt held it. */
export interface HeldLore {
  /** RPE's id of the entry, as the lore map writes it and the lead's window names it (`lore:<id>`). */
  id: string;
  title: string;
  /** Its book's name; '' where the book cannot be read. */
  source: string;
  /** How it activated, in the lore's four words; null where Lumiverse did not say. */
  how: string | null;
  /** The hash of its text as the prompt carried it; null where its text was not found in the prompt. */
  hash: string | null;
  /** The characters of that text; 0 where none was found. */
  chars: number;
  /** The file of the session's cache folder that holds its text as the lead reads it in full, by its name there; null where it could not be read. */
  file: string | null;
}

/** An entry of a scene's list, as a turn found it. */
export interface SceneLore extends HeldLore {
  /** This turn's prompt holds it. */
  here: boolean;
  /**
   * Against the prompt of the turn before: new, changed or as it was, for one this turn's prompt holds; `gone` for one the turn before
   * held and this one does not. Null for one that left earlier, and where the turn before kept no list to compare with.
   */
  status: LoreStatus | "gone" | null;
  /** What the lead did with it on the last turn that held it and kept a trace: null where no such turn is known. */
  lead: LeadChoice | null;
}

/** A turn's list, as its row keeps it: the session it was played in, and the scene's entries. */
export interface SceneKept {
  session: string;
  entries: SceneLore[];
}

/** A text's hash as the comparison reads it. */
export function loreHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const STATUSES: ReadonlySet<unknown> = new Set(["new", "changed", "same", "gone", null]);
const CHOICES: ReadonlySet<unknown> = new Set(["kept", "let_go", null]);

/** A kept list read back from its row; null where the row holds none, or one this build cannot read (it is then compared with nothing). */
export function sceneRead(value: unknown): SceneKept | null {
  if (!isRecord(value) || typeof value.session !== "string" || !Array.isArray(value.entries)) return null;
  const entries: SceneLore[] = [];
  for (const e of value.entries as unknown[]) {
    if (!isRecord(e) || typeof e.id !== "string" || typeof e.title !== "string") return null;
    if (!STATUSES.has(e.status) || !CHOICES.has(e.lead)) return null;
    entries.push({
      id: e.id,
      title: e.title,
      source: typeof e.source === "string" ? e.source : "",
      how: typeof e.how === "string" ? e.how : null,
      hash: typeof e.hash === "string" ? e.hash : null,
      chars: typeof e.chars === "number" ? e.chars : 0,
      file: typeof e.file === "string" ? e.file : null,
      here: e.here === true,
      status: e.status as SceneLore["status"],
      lead: e.lead as SceneLore["lead"],
    });
  }
  return { session: value.session, entries };
}

/** The window's name of a lore entry, as RPH's trace writes it. */
const LORE_THING = "lore:";

/**
 * What the lead of a turn did with each of `held`, the entries its prompt held, by the end of its last run: read from the records the
 * turn's folder keeps. Every entry stands whole until the lead lets it go (`let_go`, or `note`, its own note in its place), comes back
 * with `restore`, and after a `handoff` stands whole only where the handoff kept it. Only the lead's own records count: an agent it
 * started has a window of its own. Null where the folder keeps no record of a turn's run, so nothing is known.
 */
export function leadChoices(records: readonly TraceRecord[], held: readonly string[]): Map<string, LeadChoice> | null {
  let known = false;
  let out = new Map<string, LeadChoice>();
  const whole = (): Map<string, LeadChoice> => new Map(held.map((id) => [id, "kept"] as const));
  for (const record of records) {
    const { event } = record;
    if (event.kind === "run_started" && event.run === "turn") {
      // A run of the turn begins with a window of its own.
      known = true;
      out = whole();
      continue;
    }
    if (!known || event.kind !== "window" || record.agent === undefined || record.parent !== undefined) continue;
    const named = event.items.flatMap((item) => (item.id.startsWith(LORE_THING) ? [item.id.slice(LORE_THING.length)] : []));
    if (event.action === "handoff") {
      const keeps = new Set(named);
      for (const id of out.keys()) out.set(id, keeps.has(id) ? "kept" : "let_go");
    } else for (const id of named) if (out.has(id)) out.set(id, event.action === "restore" ? "kept" : "let_go");
  }
  return known ? out : null;
}

/** What a turn is compared with: the list the turn before it on the path kept, and what its lead did with what its prompt held (null where not known). */
export interface SceneBefore {
  kept: SceneKept;
  did: ReadonlyMap<string, LeadChoice> | null;
}

/**
 * The scene's list as a turn finds it: `now`, what its prompt holds, in the prompt's order, each against the turn before; then what
 * the turn before held and this one does not (`gone`); then, where the turn before was played in the same session, what had left
 * before it. A turn with nothing to compare with (the chat's first, or one whose parent kept no list) says of no entry how it stands.
 * What the lead did with an entry is what it did on the turn before where that turn held it, else what the list said already.
 */
export function sceneOf(session: string, now: readonly HeldLore[], before: SceneBefore | null): SceneKept {
  const earlier = new Map((before?.kept.entries ?? []).map((e) => [e.id, e] as const));
  const entries: SceneLore[] = [];
  const seen = new Set<string>();
  const choice = (id: string, was: SceneLore | undefined): LeadChoice | null => {
    const did = was?.here === true ? before?.did?.get(id) : undefined;
    return did ?? was?.lead ?? null;
  };
  for (const e of now) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const was = earlier.get(e.id);
    const status: LoreStatus | null = before === null ? null : was?.here !== true ? "new" : was.hash === e.hash ? "same" : "changed";
    entries.push({ ...e, here: true, status, lead: choice(e.id, was) });
  }
  if (before === null) return { session, entries };
  const same = before.kept.session === session;
  for (const was of before.kept.entries) {
    if (seen.has(was.id)) continue;
    // What the turn before held has gone; what had left before it is listed only while the scene is the same.
    if (was.here) entries.push({ ...was, here: false, status: "gone", lead: choice(was.id, was) });
    else if (same) entries.push({ ...was, here: false, status: null });
  }
  return { session, entries };
}

/**
 * The names of the lead's window (`lore:<id>`) a turn starts with let go, where the user's setting lets the lead's choice stand
 * (`lore.choiceStands`): each entry this turn's prompt holds as the turn before held it, that the lead let go then.
 */
export function standingLetGo(scene: SceneKept): string[] {
  return scene.entries.flatMap((e) => (e.here && e.status === "same" && e.lead === "let_go" ? [`${LORE_THING}${e.id}`] : []));
}

/** An entry's fields for a layout: its size in tokens as `tokens` counts its characters, a flag for how it stands and for what the lead did, and its file by its path as agents read it. */
function entryFields(e: SceneLore, tokens: (chars: number) => number, folder: string): JsonObject {
  return {
    id: e.id,
    title: e.title,
    ...(e.source !== "" ? { source: e.source } : {}),
    ...(e.how !== null ? { how: e.how, [`how_${e.how}`]: true } : {}),
    ...(e.hash !== null ? { tokens: tokens(e.chars) } : { no_text: true }),
    ...(e.status === "new" ? { is_new: true } : e.status === "changed" ? { is_changed: true } : e.status === "same" ? { is_same: true } : e.status === "gone" ? { is_gone: true } : {}),
    ...(e.lead === "kept" ? { kept: true } : e.lead === "let_go" ? { let_go: true } : {}),
    ...(e.file !== null ? { file: `${folder}${e.file}` } : {}),
  };
}

/**
 * The fields `.prompts/activated-lore.md` lays `ACTIVATED-LORE.md` out from: `here`, the entries this turn's prompt holds, and `left`,
 * those an earlier prompt of the scene held; each part absent where it holds none. `folder` is the session's cache folder as agents read it.
 */
export function sceneFields(scene: SceneKept, tokens: (chars: number) => number, folder: string): Fields {
  const here = scene.entries.filter((e) => e.here).map((e) => entryFields(e, tokens, folder));
  const left = scene.entries.filter((e) => !e.here).map((e) => entryFields(e, tokens, folder));
  return { folder, ...(scene.entries.length > 0 ? { any: true } : {}), ...(here.length > 0 ? { here: { entries: here, count: here.length } } : {}), ...(left.length > 0 ? { left: { entries: left, count: left.length } } : {}) };
}
