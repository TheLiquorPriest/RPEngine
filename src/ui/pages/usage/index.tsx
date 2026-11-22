// Usage (plan §4 "The pages show"): where the tokens went over the turns played last or over the last days, of the chat open or
// of every chat, in all and by agent, by what the calls were for, by the part of the requests, by chat and by day, each set
// against the span before it so that what grew and what shrank shows. Every figure is tokens as RPH counted them, with the
// weighted figure beside: never money, and nothing here calls a figure good or bad. The weights are settings, shown with the note
// that other providers' terms differ. Below, the press that reads in what was played before each call was kept as a row.
// One page for both shells: the tables lay themselves out by the room they have (`figures.tsx`).

import { useState } from "preact/hooks";
import type { CallsSpent, UsageReadInReply, UsageReply } from "../../../shared/api";
import { useApp } from "../../app";
import type { RpeClient } from "../../client";
import { Banner, Button, Empty, PageHeader, Row, Section, Seg } from "../../../frontend/components";
import type { PageEntry } from "../../page-entry";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords, num, when } from "../../words";
import { type FigureColumn, type FigureRow, Figures } from "./figures";
import { changeWords, operationWords, partWords, shareWords, WeightsNote } from "./words";

/** What a span counts in: the turns played last, or the last days. */
export type SpanBy = "turns" | "days";

/** The span the page shows: how many of the newest turns, or how many days to now, of the chat open or of every chat. */
export interface UsageSpan {
  by: SpanBy;
  count: number;
  ofChat: boolean;
}

/** A span's sums, and those of the span before it; `before` null where none could be asked for (a span of turns that holds no turn). */
export interface UsageShown {
  now: UsageReply;
  before: UsageReply | null;
}

/** What came of the press that reads in what was played before the rows were kept. */
export interface ReadInShown {
  reading: boolean;
  read: UsageReadInReply | null;
  problem: string | null;
}

export const NO_READ_IN: ReadInShown = { reading: false, read: null, problem: null };

/** The start of the day `back` days before the day of `at`, in the page's own time zone. */
export function dayStart(at: number, back: number): number {
  const day = new Date(at);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - back).getTime();
}

/** A count as typed: a whole number of at least 1, else null. */
export function countOf(typed: string): number | null {
  const text = typed.trim();
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) && count >= 1 ? count : null;
}

/**
 * Reads a span and the span before it. Turns: this many of the newest, then as many received before the oldest of them. Days:
 * today and the days before it, by the page's own clock, then as many days before those. Days are counted in the page's time zone.
 */
export async function readUsage(client: Pick<RpeClient, "call">, span: UsageSpan, chat: string | null, at: number): Promise<UsageShown> {
  const scope = span.ofChat && chat !== null ? { chat } : {};
  const offset = -new Date(at).getTimezoneOffset();
  if (span.by === "turns") {
    const now = await client.call("GET /api/v1/usage", {}, { query: { ...scope, turns: span.count, offset } });
    return { now, before: now.from === null ? null : await client.call("GET /api/v1/usage", {}, { query: { ...scope, turns: span.count, to: now.from, offset } }) };
  }
  const from = dayStart(at, span.count - 1);
  const [now, before] = await Promise.all([
    client.call("GET /api/v1/usage", {}, { query: { ...scope, from, offset } }),
    client.call("GET /api/v1/usage", {}, { query: { ...scope, from: dayStart(at, 2 * span.count - 1), to: from, offset } }),
  ]);
  return { now, before };
}

/** The span in words: what it holds, from when, and what it is set against. */
export function spanWords(span: UsageSpan, shown: UsageShown): string {
  const { now, before } = shown;
  const against = before !== null && before.total.calls > 0;
  if (span.by === "turns") {
    const held = now.turns ?? 0;
    if (held === 0) return "No turn has been played here yet.";
    const few = held < span.count ? `: no more than ${num(held)} ${held === 1 ? "was" : "were"} played` : "";
    const from = now.from === null ? "" : `, from ${when(now.from)} to now`;
    return `The ${held === 1 ? "turn" : `${num(held)} turns`} played last${few}${from}${against ? `, set against the ${counted(before.turns ?? 0, "turn")} before ${held === 1 ? "it" : "them"}` : "; nothing kept was played before to set against"}.`;
  }
  const from = now.from === null ? "" : `, from ${when(now.from)} to now`;
  return `${span.count === 1 ? "Today" : `Today and the ${counted(span.count - 1, "day")} before it`}${from}${against ? `, set against the ${counted(span.count, "day")} before` : "; nothing kept was played in the days before to set against"}.`;
}

const SPENT_COLUMNS: readonly FigureColumn[] = [
  { id: "calls", head: "Calls" },
  { id: "input", head: "Tokens in" },
  { id: "cacheRead", head: "Read from cache" },
  { id: "cacheWrite", head: "Written to cache" },
  { id: "output", head: "Out" },
  { id: "weighted", head: "Weighs" },
  { id: "share", head: "Share" },
];
const AGAINST: FigureColumn = { id: "against", head: "Against before" };

/** A sum's cells, one for each of `SPENT_COLUMNS`; a row the span holds no call of is there for what it was before, and has no share of this span. */
const spentCells = (spent: CallsSpent, total: CallsSpent): string[] => [num(spent.calls), num(spent.input), num(spent.cacheRead), num(spent.cacheWrite), num(spent.output), num(spent.weighted), spent.calls === 0 ? "" : shareWords(spent.weighted, total.weighted)];

/** One cut of a span as rows: each key with what it spent, and what the same key spent in the span before. */
interface Cut {
  key: string;
  name: string;
  spent: CallsSpent;
  before: CallsSpent | null;
}

const NOTHING: CallsSpent = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWriteLong: 0, output: 0, reasoning: 0, weighted: 0 };

/** The rows of a cut, those of the span shown first as the route orders them, then those the span before had and this one has not. */
function cutOf<T extends { spent: CallsSpent }>(now: readonly T[], before: readonly T[] | null, keyOf: (item: T) => string, nameOf: (item: T) => string): Cut[] {
  const was = new Map((before ?? []).map((item) => [keyOf(item), item]));
  const held = new Set(now.map(keyOf));
  return [
    ...now.map((item) => ({ key: keyOf(item), name: nameOf(item), spent: item.spent, before: before === null ? null : (was.get(keyOf(item))?.spent ?? NOTHING) })),
    ...(before ?? []).filter((item) => !held.has(keyOf(item))).map((item) => ({ key: keyOf(item), name: nameOf(item), spent: NOTHING, before: item.spent })),
  ];
}

/** What grew most and what shrank most among rows against the span before, in a line, each by how much in `unit`; null where nothing moved. */
export function moversWords(rows: readonly { name: string; now: number; before: number }[], unit: string): string | null {
  const moved = rows.map((row) => ({ name: row.name, by: row.now - row.before })).filter((row) => row.by !== 0);
  const grew = moved.filter((row) => row.by > 0).sort((a, b) => b.by - a.by)[0];
  const shrank = moved.filter((row) => row.by < 0).sort((a, b) => a.by - b.by)[0];
  const said = [grew === undefined ? null : `Grew most: ${grew.name}, +${num(grew.by)} ${unit}.`, shrank === undefined ? null : `Shrank most: ${shrank.name}, −${num(-shrank.by)} ${unit}.`].filter((line) => line !== null);
  return said.length === 0 ? null : said.join(" ");
}

function SpentTable(props: { of: string; first: string; rows: readonly Cut[]; total: CallsSpent; against: boolean }) {
  const { rows, against } = props;
  const movers = against ? moversWords(rows.map((row) => ({ name: row.name, now: row.spent.weighted, before: row.before?.weighted ?? 0 })), "weighed") : null;
  const figures: FigureRow[] = rows.map((row) => ({
    id: row.key,
    name: row.name,
    gone: row.spent.calls === 0,
    cells: [...spentCells(row.spent, props.total), ...(against ? [changeWords(row.spent.weighted, row.before?.weighted ?? 0)] : [])],
  }));
  return (
    <>
      {movers === null ? null : <p class="rpe-meta rpe-line" data-movers={props.of}>{movers}</p>}
      <Figures of={props.of} first={props.first} columns={against ? [...SPENT_COLUMNS, AGAINST] : SPENT_COLUMNS} rows={figures} />
    </>
  );
}

const PART_COLUMNS: readonly FigureColumn[] = [
  { id: "calls", head: "Calls" },
  { id: "chars", head: "Characters" },
  { id: "tokens", head: "Tokens" },
  { id: "share", head: "Share" },
];

type PartSum = UsageReply["byPart"][number];
const partKey = (part: PartSum): string => `${part.part}\u0000${part.name ?? ""}`;

function PartsTable(props: { now: UsageReply; before: UsageReply | null; against: boolean }) {
  const { now, before, against } = props;
  const all = now.byPart.reduce((sum, part) => sum + part.tokens, 0);
  const was = new Map((before?.byPart ?? []).map((part) => [partKey(part), part]));
  const held = new Set(now.byPart.map(partKey));
  const gone = against ? (before?.byPart ?? []).filter((part) => !held.has(partKey(part))) : [];
  const rows: FigureRow[] = [
    ...now.byPart.map((part) => ({
      id: partKey(part),
      name: partWords(part.part, part.name),
      cells: [num(part.calls), num(part.chars), num(part.tokens), shareWords(part.tokens, all), ...(against ? [changeWords(part.tokens, was.get(partKey(part))?.tokens ?? 0)] : [])],
    })),
    ...gone.map((part) => ({ id: partKey(part), name: partWords(part.part, part.name), gone: true, cells: ["0", "0", "0", "", changeWords(0, part.tokens)] })),
  ];
  const movers = against ? moversWords([...now.byPart.map((part) => ({ name: partWords(part.part, part.name), now: part.tokens, before: was.get(partKey(part))?.tokens ?? 0 })), ...gone.map((part) => ({ name: partWords(part.part, part.name), now: 0, before: part.tokens }))], "tokens") : null;
  const without = now.total.calls - now.withParts;
  return (
    <>
      <p class="rpe-meta rpe-line">Each part's characters and its tokens by RPH's own estimate, added up over the calls that carried it; the share is of all the parts here.</p>
      {without === 0 ? null : (
        <p class="rpe-meta rpe-line" data-totals-only={without}>
          {now.withParts === 0
            ? `None of these ${counted(now.total.calls, "call")} carries its request by part: their rows were read in from traces kept before requests were told by part, and hold each call's totals alone.`
            : `${counted(without, "call")} of the ${num(now.total.calls)} here ${without === 1 ? "carries its" : "carry their"} totals alone: read in from traces kept before requests were told by part. The parts below are of the other ${num(now.withParts)}.`}
        </p>
      )}
      {movers === null ? null : <p class="rpe-meta rpe-line" data-movers="parts">{movers}</p>}
      {rows.length === 0 ? null : <Figures of="parts" first="Part of the request" columns={against ? [...PART_COLUMNS, AGAINST] : PART_COLUMNS} rows={rows} />}
    </>
  );
}

/** A figure of the whole span, with how it stands against the span before. */
function Whole(props: { of: string; k: string; now: number; before: number | null; sub?: string }) {
  const change = props.before === null ? "" : changeWords(props.now, props.before);
  const sub = [props.sub, change === "" ? null : `Against the span before: ${change}.`].filter((part) => part !== undefined && part !== null).join(" ");
  return (
    <Row
      k={props.k}
      v={
        <span class="lre-num" data-whole={props.of}>
          {num(props.now)}
        </span>
      }
      sub={sub === "" ? undefined : sub}
    />
  );
}

export interface UsageViewProps {
  span: UsageSpan;
  /** The count as typed. */
  typed: string;
  /** The chat the page is on, offered as the scope beside every chat; null where it is on none. */
  chat: string | null;
  shown: UsageShown | null;
  /** A read is out: what was read before stays shown until it answers. */
  loading: boolean;
  problem: string | null;
  /** The chats' names, by id, for the sums by chat. */
  chatNames: ReadonlyMap<string, string>;
  readIn: ReadInShown;
  onBy(by: SpanBy): void;
  onTyped(text: string): void;
  onScope(ofChat: boolean): void;
  onAgain(): void;
  onReadIn(): void;
  onOpenSetting?: ((key: string) => void) | undefined;
}

function ReadIn(props: { shown: ReadInShown; kept: UsageReply["kept"] | undefined; onReadIn(): void }) {
  const { read, problem, reading } = props.shown;
  const { kept } = props;
  return (
    <Section id="read-in" title="What was played before the rows were kept">
      <p class="rpe-line">RPE keeps a row for each model call as it ends. The turns and the jobs played before it did still have their traces: reading them in adds a row for each of their calls. A trace kept before requests were told by part gives each call's totals alone.</p>
      <div class="lre-inline">
        <Button onClick={props.onReadIn} busy={reading}>
          Read them in
        </Button>
        {kept === null || kept === undefined ? null : (
          <span class="rpe-meta" data-kept={kept.setting}>
            {kept.name}: {counted(kept.days, "day")}. Rows of calls older than that, read in now, are removed at the next turn's end.
          </span>
        )}
      </div>
      {reading ? <p class="lre-muted rpe-line">Reading the kept traces…</p> : null}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="They could not be read in">
          <span>{problem}</span>
        </Banner>
      )}
      {read === null ? null : (
        <p class="rpe-line" data-read-in>
          {read.turns + read.jobs + read.unread === 0
            ? "Nothing was left to read in: every turn and every job that ended has its rows."
            : `Read ${counted(read.turns, "turn folder")} and ${counted(read.jobs, "job")}: ${counted(read.calls, "call")} added${read.withoutParts === 0 ? "" : `, ${num(read.withoutParts)} of them with ${read.withoutParts === 1 ? "its" : "their"} totals alone`}, and ${counted(read.sent, "item")} handed to agents.${read.unread === 0 ? "" : ` ${counted(read.unread, "trace")} could not be read: RPE's log says why, and the next press tries ${read.unread === 1 ? "it" : "them"} again.`}`}
        </p>
      )}
    </Section>
  );
}

export function UsageView(props: UsageViewProps) {
  const { span, shown } = props;
  const now = shown?.now ?? null;
  const before = shown?.before ?? null;
  const against = before !== null && before.total.calls > 0;
  const was = against ? before : null;
  const chatName = (chat: string | null): string => (chat === null ? "Jobs of no chat" : (props.chatNames.get(chat) ?? chat));
  return (
    <div class="lre-stack rpe-page" data-page="usage" aria-busy={props.loading ? "true" : undefined}>
      <PageHeader
        title="Usage"
        subtitle="Where the tokens went: tokens, and what they weigh. Never money."
        actions={
          <Button size="sm" variant="ghost" onClick={props.onAgain}>
            Read again
          </Button>
        }
      />
      <div class="rpe-use-span" data-span={span.by}>
        <Seg
          label="What the span counts in"
          value={span.by}
          options={[
            { value: "turns", label: "Last turns" },
            { value: "days", label: "Last days" },
          ]}
          onChange={props.onBy}
        />
        <label class="lre-inline">
          <span class="rpe-meta">{span.by === "turns" ? "How many turns" : "How many days"}</span>
          <input class="lre-input rpe-use-count" inputMode="numeric" value={props.typed} aria-invalid={countOf(props.typed) === null ? "true" : undefined} onInput={(e) => props.onTyped((e.currentTarget as HTMLInputElement).value)} />
        </label>
        {props.chat === null ? null : (
          <Seg
            label="Whose calls"
            value={span.ofChat ? "chat" : "all"}
            options={[
              { value: "chat", label: "This chat" },
              { value: "all", label: "Every chat" },
            ]}
            onChange={(scope) => props.onScope(scope === "chat")}
          />
        )}
      </div>
      {countOf(props.typed) !== null ? null : <p class="rpe-meta rpe-line" data-bad-count>A span is a whole number of at least 1: {counted(span.count, span.by === "turns" ? "turn" : "day")} {span.count === 1 ? "is" : "are"} shown.</p>}
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The usage could not be read" actions={<Button onClick={props.onAgain}>Try again</Button>}>
          <span>{props.problem}</span>
        </Banner>
      )}
      {now === null || shown === null ? (
        props.problem === null ? <p class="lre-muted rpe-line">Reading the usage…</p> : null
      ) : (
        <>
          <p class="rpe-meta rpe-line" data-span-words>
            {spanWords(span, shown)}
          </p>
          {now.total.calls === 0 ? (
            <Empty icon="table" title="No model call is kept in this span">
              <span>Nothing was played in it, or its rows are no longer kept. What was played before the rows were kept can be read in below.</span>
            </Empty>
          ) : (
            <>
              <Section id="total" title="In all">
                <Whole of="calls" k="Model calls" now={now.total.calls} before={was?.total.calls ?? null} />
                <Whole
                  of="input"
                  k="Tokens sent"
                  now={now.total.input}
                  before={was?.total.input ?? null}
                  sub={`${num(now.total.cacheRead)} read from the provider's cache and ${num(now.total.cacheWrite)} written to it${now.total.cacheWriteLong === 0 ? "" : ` (${num(now.total.cacheWriteLong)} for its long lifetime)`}, both among them.`}
                />
                <Whole of="output" k="Tokens written" now={now.total.output} before={was?.total.output ?? null} {...(now.total.reasoning === 0 ? {} : { sub: `${num(now.total.reasoning)} of them reasoning.` })} />
                <Whole of="weighted" k="Weighs" now={now.total.weighted} before={was?.total.weighted ?? null} />
                <WeightsNote weights={now.weights} onOpenSetting={props.onOpenSetting} />
              </Section>
              <Section id="by-agent" title="By agent">
                <SpentTable of="agents" first="Agent" total={now.total} against={against} rows={cutOf(now.byDefinition, was?.byDefinition ?? null, (item) => item.definition, (item) => item.definition)} />
              </Section>
              <Section id="by-operation" title="By what the calls were for">
                <SpentTable of="operations" first="What for" total={now.total} against={against} rows={cutOf(now.byOperation, was?.byOperation ?? null, (item) => item.operation ?? "", (item) => operationWords(item.operation))} />
              </Section>
              <Section id="by-part" title="By part of the request">
                <PartsTable now={now} before={was} against={against} />
              </Section>
              {span.ofChat ? null : (
                <Section id="by-chat" title="By chat">
                  <SpentTable of="chats" first="Chat" total={now.total} against={against} rows={cutOf(now.byChat, was?.byChat ?? null, (item) => item.chat ?? "", (item) => chatName(item.chat))} />
                </Section>
              )}
              <Section id="by-day" title="By day">
                <SpentTable of="days" first="Day" total={now.total} against={false} rows={cutOf(now.byDay, null, (item) => item.day, (item) => item.day)} />
              </Section>
            </>
          )}
        </>
      )}
      <ReadIn shown={props.readIn} kept={now?.kept} onReadIn={props.onReadIn} />
    </div>
  );
}

/** The page: the span he chose, read with the span before it; read again after a reading in. */
export function UsagePage(props: { chat: string | null }) {
  const app = useApp();
  const { chat } = props;
  const turns = useUiSetting("usageTurns");
  const days = useUiSetting("usageDays");
  const [by, setBy] = useState<SpanBy>("turns");
  // What he typed for the count, for the kind of span shown; until he types, the page's setting for it.
  const [typed, setTyped] = useState<string | null>(null);
  const [every, setEvery] = useState(false);
  const [readIn, setReadIn] = useState<ReadInShown>(NO_READ_IN);
  const usual = by === "turns" ? turns : days;
  const [count, setCount] = useState<number | null>(null);
  const span: UsageSpan = { by, count: count ?? usual, ofChat: chat !== null && !every };
  const read = useRead(() => readUsage(app.client, span, chat, Date.now()), [span.by, span.count, span.ofChat, chat]);
  const chats = useRead(async () => new Map((await app.client.call("GET /api/v1/chats", {})).chats.map((c) => [c.id, c.name])), []);
  return (
    <UsageView
      span={span}
      typed={typed ?? String(usual)}
      chat={chat}
      shown={read.value}
      loading={read.loading}
      problem={read.problem}
      chatNames={chats.value ?? new Map()}
      readIn={readIn}
      onBy={(next) => {
        setBy(next);
        setTyped(null);
        setCount(null);
      }}
      onTyped={(text) => {
        setTyped(text);
        const whole = countOf(text);
        if (whole !== null) setCount(whole);
      }}
      onScope={(ofChat) => setEvery(!ofChat)}
      onAgain={read.again}
      onReadIn={() => {
        setReadIn({ reading: true, read: null, problem: null });
        app.client.call("POST /api/v1/usage/read-in", {}).then(
          (found) => {
            setReadIn({ reading: false, read: found, problem: null });
            read.again();
          },
          (error: unknown) => setReadIn({ reading: false, read: null, problem: errorWords(error) }),
        );
      }}
      onOpenSetting={(key) => app.go({ page: "settings", chat: null, at: [key] })}
    />
  );
}

export const entry: PageEntry = { id: "usage", title: "Usage", icon: "table", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 45, render: (route) => <UsagePage chat={route.chat ?? null} /> };
