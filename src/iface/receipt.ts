// A write's receipt (plan §5.2). With the user's `tools.receiptTokens` at a number, a tool that writes answers with a receipt: what
// it wrote and under which ids, what the engine made of it that the call did not send, and every line about what did not add up.
// The answer as the tool gave it (what the call sent given back, how each thing now stands) is kept whole in a file of the call's
// turn, which the receipt's last line names, and the ordinary file tool reads. With the setting at none the host gives no keeper,
// and every answer is the tool's whole answer.
//
// A receipt is made of the answer itself: its lines as they are, its reports untouched, and in place of its data what the tool said
// a receipt holds (`Reply.receipt`). A tool that names none is its own receipt while its answer fits the size; past it, its data is
// left to the file. A receipt longer than the size gives up what it lists of what was written, from the end of the last list, and a
// line says how many it left to the file; no line of the answers' file and no report is cut. A failed answer is never made a
// receipt: its lines tell the caller how to mend the call. Nothing is lost for a receipt: where no line in force names the file
// (his own answers part has none), or the file could not be kept, the answer is given whole.

import type { FilesPort, JsonValue, Log, Scope, ToolContent, ToolResult } from "rp-harness/contract";
import type { PartKind, Reply } from "./kit";
import type { Lines } from "./texts";

/**
 * The folder inside a turn's (a session's, for a run with no turn) that holds the whole of each answer given as a receipt, a file to
 * a call. It is RPE's own, beside `cache/results/`, which is RPH's for the whole of an answer RPH itself clipped: a receipt the gate
 * then clips is kept there, and never written over the answer it stands for.
 */
const KEPT_ANSWERS = "cache/answers/";

/** The answers' line that names the file a receipt's whole answer is in: a receipt's last line. */
export const RECEIPT_KEPT = "receipt_kept";
/** The answers' line that says how many of what was written a receipt left to the file. */
export const RECEIPT_LEFT = "receipt_left";

/** What a host gives its tools to answer with receipts: the size of one, and where the whole of an answer is kept. */
export interface ReceiptKeeper {
  /** The most characters a receipt holds, its lines and reports among them and never cut: the user's `tools.receiptTokens` at the chat's characters to a token. */
  chars: number;
  /** Keeps the whole of a call's answer in a file of its turn (its session's, for a run with no turn): the file's path as the file tool reads it, or undefined when it could not be kept. */
  keep(scope: Scope, callId: string, text: string): Promise<string | undefined>;
}

/** A keeper over the host's files: each whole answer written as the harness, in the `cache/answers/` of its turn. One that cannot be kept is logged, and its answer is given whole. */
export function receiptKeeper(files: Pick<FilesPort, "places" | "write">, chars: number, log: Pick<Log, "warn">): ReceiptKeeper {
  const failed = "The whole of a tool's answer could not be kept in the turn's folder; the answer was given whole, with no receipt.";
  return {
    chars,
    async keep(scope, callId, text) {
      try {
        const places = await files.places(scope);
        const written = await files.write(scope, `${places.turn ?? places.session}${KEPT_ANSWERS}${callId.replace(/[^A-Za-z0-9._-]/g, "_")}.md`, { op: "write", text }, "harness");
        if (written.status === "written") return written.path;
        log.warn(failed, { callId, path: written.path, status: written.status, reason: written.reason });
      } catch (error) {
        log.warn(failed, { callId, error: error instanceof Error ? error.message : String(error) });
      }
      return undefined;
    },
  };
}

/** A receipt's own parts, before the lines that say what it left out and where the whole is. */
interface Short {
  content: ToolContent[];
  kinds: PartKind[];
  /** How many of what was written it does not list, of how many. */
  left: number;
  of: number;
}

/**
 * What a receipt of `reply` holds within `room` characters: the answer's lines in their places, and in place of its data what the tool
 * said a receipt holds, its lists cut from the end of the last where it is too long and `cuts` (a line in force says what was left out).
 * Null where that leaves nothing of the answer out: the answer is its own receipt.
 */
function shortened(reply: Reply, room: number, cuts: boolean): Short | null {
  const data = reply.kinds.flatMap((kind, i) => (kind === "data" ? [i] : []));
  const sizes = reply.parts.map((part) => (part.type === "text" ? part.text.length : 0));
  const dataSize = data.reduce((sum, i) => sum + (sizes[i] ?? 0), 0);
  // What a receipt never cuts: the answer's lines, and its reports.
  const fixed = sizes.reduce((sum, size) => sum + size, 0) - dataSize + reply.reports.reduce((sum, report) => sum + report.length, 0);
  /** The answer's parts with `text` in place of its data; with none, its lines alone. */
  const inPlace = (text: string | null): Short => {
    const content: ToolContent[] = [];
    const kinds: PartKind[] = [];
    for (const [i, part] of reply.parts.entries()) {
      const kind = reply.kinds[i] ?? "line";
      if (kind !== "data") {
        content.push(part);
        kinds.push(kind);
      } else if (i === data[0] && text !== null) {
        content.push({ type: "text", text });
        kinds.push("data");
      }
    }
    // An answer that had no data of its own: what the receipt holds goes after its lines.
    if (data.length === 0 && text !== null) {
      content.push({ type: "text", text });
      kinds.push("data");
    }
    return { content, kinds, left: 0, of: 0 };
  };
  const wrote = reply.wrote;
  if (wrote === null) {
    // A tool that names no receipt says nothing its caller sent: its answer is its own receipt while it fits, and past the size its data is the file's.
    if (data.length === 0 || fixed + dataSize <= room) return null;
    return inPlace(null);
  }
  const names = Object.keys(wrote.lists);
  const all = names.flatMap((name) => (wrote.lists[name] ?? []).map((entry) => [name, entry] as const));
  const dataOf = (kept: number): string => {
    const lists = new Map<string, JsonValue[]>();
    // A list the tool wrote nothing in says so; one the receipt holds none of is left out, and counted in what the file has.
    for (const name of names) if ((wrote.lists[name] ?? []).length === 0) lists.set(name, []);
    for (const [name, entry] of all.slice(0, kept)) lists.set(name, [...(lists.get(name) ?? []), entry]);
    return JSON.stringify({ ...Object.fromEntries(names.flatMap((name) => (lists.has(name) ? [[name, lists.get(name) ?? []] as const] : []))), ...wrote.rest });
  };
  let kept = all.length;
  if (cuts && fixed + dataOf(kept).length > room) {
    // As many as fit, counted from the first list's first entry: a receipt only grows with what it lists. None fits: none is listed.
    kept = 0;
    for (let low = 1, high = all.length - 1; low <= high; ) {
      const mid = (low + high) >> 1;
      if (fixed + dataOf(mid).length <= room) {
        kept = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
  }
  const text = dataOf(kept);
  const only = data.length === 1 ? reply.parts[data[0] ?? -1] : undefined;
  if (kept === all.length && only?.type === "text" && only.text === text) return null;
  // A receipt that lists nothing and holds nothing beside its lists has no data to show: its lines and the file's say it all.
  return { ...inPlace(text === "{}" ? null : text), left: all.length - kept, of: all.length };
}

/**
 * The answer a tool that writes gave, as its caller reads it under a keeper: a receipt, its whole kept in the file its last line names;
 * or the answer whole, where it failed, where it is its own receipt, where no line in force names the file, and where the file could
 * not be kept. The lines the receipt adds are `lines`' own (`receipt_left`, `receipt_kept`); what the Turn page shows of the call gains
 * `receipt` in its details: the file's path, the whole answer's length, and how many of what was written the receipt left to the file.
 * The answer names the file as the one that holds it whole (`kept`), so that the harness keeps no second copy and what a session
 * carries of the answer into later turns names it too.
 */
export async function receiptOf(reply: Reply, lines: Lines, keeper: ReceiptKeeper, call: { scope: Scope; callId: string; tool: string }): Promise<ToolResult> {
  const whole = reply.result();
  if (reply.failed || !lines.has(RECEIPT_KEPT)) return whole;
  const short = shortened(reply, keeper.chars, lines.has(RECEIPT_LEFT));
  if (short === null) return whole;
  // The whole as the gate keeps one: what the model would have read, its parts and then its reports, a line each.
  const text = [...whole.content.flatMap((part) => (part.type === "text" ? [part.text] : [])), ...reply.reports].join("\n");
  const path = await keeper.keep(call.scope, call.callId, text);
  if (path === undefined) return whole;
  const named = lines.line(RECEIPT_KEPT, { tool: call.tool, path, chars: text.length });
  if (named === undefined || named.trim() === "") return whole;
  const left = short.left > 0 ? lines.line(RECEIPT_LEFT, { tool: call.tool, left: short.left, of: short.of, listed: short.of - short.left }) : undefined;
  const said = [left, named].filter((line): line is string => line !== undefined && line.trim() !== "");
  return {
    ...whole,
    kept: path,
    content: [...short.content, ...said.map((line): ToolContent => ({ type: "text", text: line }))],
    details: { ...reply.details, parts: [...short.kinds, ...said.map((): PartKind => "line")], receipt: { path, chars: text.length, ...(short.left > 0 ? { left: short.left } : {}) } },
  };
}
