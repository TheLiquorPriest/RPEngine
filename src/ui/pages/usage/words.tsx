// What the pages say of the use of the models (plan §4 "The pages show"), shared by the Usage page and the Turn page's "Where the
// tokens went": what a call was for and each part of a request in plain words, a set of calls' tokens in a line with what they
// weigh, how a figure stands against the one before it, and the note that says what the weights are and that other providers'
// terms differ. Tokens, and tokens weighed: never money. Nothing here calls a figure good or bad: the pages show where tokens went.

import type { AgentOperation, CallsSpent, RequestPartKind, SentItem, UsageWeightsShown } from "../../../shared/api";
import { Button } from "../../../frontend/components";
import { counted, num } from "../../words";

/** What an agent's calls were for, as RPH names it, in the page's words. */
export const OPERATION_WORDS: Readonly<Record<AgentOperation, string>> = {
  lead: "leading the turn",
  sub: "a sub-agent's work",
  task: "a task",
  writer: "writing the reply",
  job: "a job",
  compaction: "a compaction's summary",
  save: "saving before a compaction",
  judge: "judging a rule's question",
  "tag-check": "a tag check",
  reader: "reading for another agent",
  warm: "keeping the cache warm",
};

/** What calls were for; a call kept before RPH named it says so. */
export function operationWords(operation: AgentOperation | null): string {
  return operation === null ? "not named (kept before RPH told it)" : OPERATION_WORDS[operation];
}

/** Each part of a request, in the page's words. */
export const PART_WORDS: Readonly<Record<RequestPartKind, string>> = {
  opening: "its opening block",
  tools: "its tools as declared",
  frame: "the line that frames the prompt",
  prompt: "the chat's prompt",
  carry: "what the session carries",
  briefing: "the briefing",
  given: "given by name",
  brief: "its brief",
  rule: "a rule's text",
  reminder: "RPH's reminders and notices",
  said: "what it said before",
  thinking: "its thinking",
  calls: "its tool calls",
  results: "tool results",
  summary: "a compaction's summary",
};

/** A part with its name where it has one: "the chat's prompt: lore", "tool results: delegate". */
export function partWords(part: RequestPartKind, name: string | null | undefined): string {
  return name === null || name === undefined ? PART_WORDS[part] : `${PART_WORDS[part]}: ${name}`;
}

/** Who chose an item an agent was handed. */
export const SENT_FROM_WORDS: Readonly<Record<SentItem["from"], string>> = {
  definition: "its definition's",
  caller: "its caller's",
  pin: "pinned by you",
  opening: "its opening's",
  again: "given again, changed",
};

/** Tokens as RPH counted them: sent (those read from the cache and written to it among them), read from the cache, written to it and of that for its long lifetime, written by the model, and of that its reasoning. */
export interface TokensCounted {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteLong?: number;
  output: number;
  reasoning?: number | null;
}

/** Tokens as counted, in a line: "12,345 in (8,000 read from the cache, 900 written to it) · 456 out (120 reasoning)". RPH's `input` holds the cached ones: nothing is added twice. */
export function tokensLine(of: TokensCounted): string {
  const long = of.cacheWriteLong !== undefined && of.cacheWriteLong > 0 ? (of.cacheWriteLong === of.cacheWrite ? " for its long lifetime" : `, ${num(of.cacheWriteLong)} of them for its long lifetime`) : "";
  const cached = [of.cacheRead > 0 ? `${num(of.cacheRead)} read from the cache` : null, of.cacheWrite > 0 ? `${num(of.cacheWrite)} written to it${long}` : null].filter((part) => part !== null);
  const reasoning = of.reasoning !== undefined && of.reasoning !== null && of.reasoning > 0 ? ` (${num(of.reasoning)} reasoning)` : "";
  return `${num(of.input)} in${cached.length === 0 ? "" : ` (${cached.join(", ")})`} · ${num(of.output)} out${reasoning}`;
}

/** What a set of calls spent, in a line: its calls, its tokens, and what they weigh. */
export function spentLine(spent: CallsSpent): string {
  return `${counted(spent.calls, "call")} · ${tokensLine(spent)} · weighs ${num(spent.weighted)}`;
}

/** A share of a whole, in whole percents: "37%", "<1%" for a little, "" where the whole is nothing. */
export function shareWords(part: number, whole: number): string {
  if (whole <= 0) return "";
  const share = (part / whole) * 100;
  return share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
}

/**
 * How a figure stands against the same figure of the span before: "+12,300 (+43%)", "−4,100 (−12%)", "−40 (under 1%)", "the
 * same"; "new" where the span before had none of it, and "gone" where this one has none. Only the difference is said, never whether
 * it is good.
 */
export function changeWords(now: number, before: number): string {
  if (now === before) return now === 0 ? "" : "the same";
  if (before === 0) return `new (+${num(now)})`;
  if (now === 0) return `gone (−${num(before)})`;
  const by = now - before;
  const percent = Math.abs((by / before) * 100);
  const sign = by > 0 ? "+" : "−";
  return `${sign}${num(Math.abs(by))} (${percent < 1 ? "under 1%" : `${sign}${num(Math.round(percent))}%`})`;
}

/** The first of the weights' settings, where the Settings page opens on them. */
export const WEIGHTS_SETTING = "usage.weights.cacheRead";

const four = (w: { cacheRead: number; cacheWrite: number; cacheWriteLong: number; output: number }): string =>
  `one read from the provider's cache ${num(w.cacheRead)}, one written to it ${num(w.cacheWrite)} (${num(w.cacheWriteLong)} where its call asked the cache's long lifetime), and one the model wrote ${num(w.output)}`;

/** What the weighted figure is, by the weights in force, and that other providers' terms differ (plan §4; the design's 1.3). */
export function WeightsNote(props: { weights: UsageWeightsShown; onOpenSetting?: ((key: string) => void) | undefined }) {
  const { weights, onOpenSetting } = props;
  return (
    <div class="lre-stack rpe-use-weights" data-weights>
      <p class="rpe-meta rpe-line">
        What tokens weigh: a token sent fresh counts 1, {four(weights)}. The weights are your settings, shipped as the terms of one provider: other providers' terms differ, and a connection can have weights of its own. It is tokens weighed, never money.
      </p>
      {weights.connections.map((own) => (
        <p key={own.connection} class="rpe-meta rpe-line" data-weights-of={own.connection}>
          On {own.connection}: {four(own)}.
        </p>
      ))}
      {onOpenSetting === undefined ? null : (
        <div class="lre-inline">
          <Button size="sm" variant="ghost" onClick={() => onOpenSetting(WEIGHTS_SETTING)}>
            The weights, in Settings
          </Button>
        </div>
      )}
    </div>
  );
}
