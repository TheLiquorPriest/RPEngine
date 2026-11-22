// Where the tokens went, as the pages show it (plan §4 "The pages show"), drawn from what the routes themselves answer over rows
// written from an invented turn's trace (`test/turn/usage-rig.ts`): the Usage page in both shells (a span in all and by agent, by
// what the calls were for and by part, each with what it weighs, set against the span before so that what grew and what shrank
// shows; the weights with the word that other providers' terms differ; never money); a weight changed in the settings changing the
// weighted figure at the next read; the press that reads in what was played before, with how long rows are kept beside it; the
// Turn page's section, a turn's calls by agent and by part behind the spoiler gate, with a call after the reply and a cold write
// marked, and the job it started with its own use; the turn's line with its jobs beside it; and the preview's stand-in answers,
// held to the routes' declarations. Every name and every figure is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { type AnyShape, problemsOf } from "../../src/app";
import type { TurnReply, TurnRow, TurnUseReply } from "../../src/shared/api";
import { kvStore } from "../../src/turn";
import { readInReply, turnUseReply, usageReply } from "../../src/turn/usage-routes";
import { AppContext, type Route, type Shell, type UiApp } from "../../src/ui/app";
import type { RpeClient } from "../../src/ui/client";
import { PageFor, routeFor } from "../../src/ui/frame";
import { createGate } from "../../src/ui/gate";
import { PAGES } from "../../src/ui/page-list";
import { NO_FOLDER, TURN_SECTIONS, TurnsView, TurnView, type TurnViewProps } from "../../src/ui/pages/turns";
import { changeWords, type TokensCounted, tokensLine } from "../../src/ui/pages/usage/words";
import { applyRead, EMPTY_LIVE, runsOf } from "../../src/ui/live-model";
import { answered, before, calling, CHAT, ended, JOB, jobRecord, recorder, RUN, SCOPE, spent, started, T0, TURN, turnRecords, type UsagePages, usagePages } from "../turn/usage-rig";
import { settle } from "./asking";
import { openPage, type Page, PageEvent, type PageElement } from "./kept/dom";
import { summaryOf, turnAt } from "./recorded";
import { READ_IN, SPAN, SPAN_BEFORE, turnUse, usageSpan, withUse } from "./usage-recorded";
import { elements, expand, textOf } from "./vnodes";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LANDING = "turn-landing";

const beds: UsagePages[] = [];
let page: Page | null = null;
afterEach(async () => {
  page?.close();
  page = null;
  for (const p of beds.splice(0)) await p.b.close();
});

/**
 * Two turns as their traces told them, the rows of their calls kept as the calls ran. The older, the ferry's: the Author's two
 * calls, the GM's one, and a job's. The newer, the landing's, five hours on: the same Author and GM, no job, and a place agent's
 * call beside them. So against the turn before, the newer one's place agent is new and its historian's job is gone.
 */
async function played(): Promise<UsagePages> {
  const p = await usagePages();
  beds.push(p);
  await p.played({ id: "r-ferry", turn: TURN, received: T0 - 500, traceRun: RUN });
  await p.played({ id: "r-landing", turn: LANDING, received: T0 + 5 * HOUR - 500, traceRun: "run-landing" });
  const landing = recorder("run-landing", { ...SCOPE, turn: LANDING }, T0 + 5 * HOUR);
  const scout = { id: "agent-scout", definition: "place", parent: "agent-author" };
  const records = [
    ...turnRecords(),
    ...turnRecords({ turn: LANDING, run: "run-landing", job: "job-landing", at: 5 * HOUR }).filter((record) => record.run !== "job-landing"),
    landing(scout, 6_300, started("place", { operation: "sub" })),
    landing(scout, 6_310, calling(1, { parts: [{ part: "opening", chars: 3_600, tokens: 900 }, { part: "brief", chars: 240, tokens: 60 }] })),
    landing(scout, 7_310, answered(1, spent(1_200, 0, 0, 50), 1_000)),
    landing(scout, 7_311, ended(spent(1_200, 0, 0, 50))),
  ];
  for (const record of records) p.b.calls.record(record);
  await p.b.calls.settled();
  // The ferry's job by its own record, which ties it to its turn.
  await kvStore(p.b.db, p.b.writes).jobs.set(SCOPE, jobRecord());
  return p;
}

/** A page's client whose calls are answered by the routes themselves, each call noted. */
function clientOver(p: UsagePages): { client: Pick<RpeClient, "call">; asked: { key: string; query: unknown }[] } {
  const asked: { key: string; query: unknown }[] = [];
  const call = async (key: string, params: Readonly<Record<string, string>>, options?: { query?: Record<string, string | number> }): Promise<unknown> => {
    asked.push({ key, query: options?.query });
    if (key === "GET /api/v1/usage") return p.span(options?.query ?? {});
    if (key === "POST /api/v1/usage/read-in") return p.readIn();
    if (key === "GET /api/v1/chats/:chat/turns/:turn/use") return p.use(params.turn ?? "", params.chat);
    if (key === "GET /api/v1/chats") return { chats: [{ id: CHAT, name: "The salt marsh", lastTurnAt: T0, running: false, played: true, world: null }] };
    throw new Error(`not asked here: ${key}`);
  };
  return { client: { call: call as RpeClient["call"] }, asked };
}

/** The Usage page drawn in a shell as the shell's frame draws it, from the routes; the page it stands on is closed after the test. */
async function drawn(p: UsagePages, shell: Shell, chat: string | null = CHAT) {
  page ??= openPage();
  const { client, asked } = clientOver(p);
  const gone: Route[] = [];
  const app = { shell, client, gate: createGate(), go: (route: Route) => gone.push(route) } as unknown as UiApp;
  const root = page.document.createElement("div") as PageElement;
  await act(() => {
    render(h(AppContext.Provider, { value: app }, h(PageFor, { route: routeFor("usage", chat) })), root as unknown as HTMLElement);
  });
  /** Lets the page's reads, and the reads they lead to, come back. */
  const read = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await act(() => settle());
  };
  await read();
  const text = (): string => root.textContent.replace(/\s+/g, " ");
  const button = (words: string): PageElement => root.querySelectorAll("button").find((b) => b.textContent.trim() === words) as PageElement;
  const marked = (name: string): PageElement[] => root.querySelectorAll("*").filter((el) => el.getAttribute(name) !== null);
  return {
    root,
    asked,
    gone,
    text,
    read,
    marked,
    /** A figure of the whole span, by what it is of: its calls, the tokens sent and written, what they weigh. */
    whole: (of: string): string | undefined => marked("data-whole").find((el) => el.getAttribute("data-whole") === of)?.textContent,
    /** What a row of a table says: its cells' words, by the column each is under (the column's name, which each cell carries for where the rows stack, left off). */
    row(table: string, id: string): Record<string, string> {
      const figures = marked("data-figures").find((el) => el.getAttribute("data-figures") === table);
      const row = figures?.querySelectorAll("*").find((el) => el.getAttribute("data-row") === id);
      if (row === undefined) throw new Error(`The table ${table} has no row ${id}.`);
      const cells = row.children.filter((cell) => cell.getAttribute("data-cell") !== null);
      return Object.fromEntries(cells.map((cell) => [cell.getAttribute("data-cell") ?? "", cell.textContent.slice((cell.children[0]?.textContent ?? "").length).trim()]));
    },
    async press(words: string): Promise<void> {
      await act(() => button(words).click());
      await read();
    },
    async type(value: string): Promise<void> {
      const input = root.querySelector("input") as PageElement & { value: string };
      input.value = value;
      await act(() => {
        input.dispatchEvent(new PageEvent("input"));
      });
      await read();
    },
    async close(): Promise<void> {
      await act(() => render(null, root as unknown as HTMLElement));
    },
  };
}

describe("the Usage page, in both shells, from the routes", () => {
  test("each shell lists it and draws the span in all, by agent, by what the calls were for and by part, with what each weighs and never money", async () => {
    expect(PAGES.find((entry) => entry.id === "usage")?.shells).toEqual(["web", "drawer"]);
    const p = await played();
    for (const shell of ["web", "drawer"] as const) {
      const shown = await drawn(p, shell);
      const text = shown.text();
      // The page asked the routes: the turns played last (both of them, twenty being asked), then as many before the oldest of those.
      expect(shown.asked.filter((a) => a.key === "GET /api/v1/usage").map((a) => a.query)).toEqual([
        { chat: CHAT, turns: 20, offset: -new Date().getTimezoneOffset() },
        { chat: CHAT, turns: 20, to: T0 - 500, offset: -new Date().getTimezoneOffset() },
      ]);
      expect(text).toContain("The 2 turns played last: no more than 2 were played");
      expect(text).toContain("nothing kept was played before to set against");
      // In all: eight calls, their tokens as RPH counted them, and what they weigh as shipped (37,770 for the ferry with its job, 32,720 for the landing).
      for (const section of ["In all", "By agent", "By what the calls were for", "By part of the request", "By day"]) expect(text).toContain(section);
      expect(["calls", "input", "output", "weighted"].map(shown.whole)).toEqual(["8", "49,300", "3,550", "70,490"]);
      expect(text).toContain("16,400 read from the provider's cache and 18,200 written to it (18,200 for its long lifetime)");
      // By agent, the one that weighs most first, each with its share of the weight.
      expect(shown.marked("data-row").filter((el) => el.closest("[data-figures]")?.getAttribute("data-figures") === "agents").map((el) => el.getAttribute("data-row"))).toEqual(["author", "gm", "historian", "place"]);
      expect(shown.row("agents", "author")).toEqual({ calls: "4", input: "37,600", cacheRead: "16,400", cacheWrite: "18,200", output: "1,500", weighted: "48,540", share: "69%" });
      expect(shown.row("agents", "historian")).toMatchObject({ calls: "1", weighted: "6,500", share: "9%" });
      // By what the calls were for, in the page's words, and by part.
      expect(shown.row("operations", "lead")).toMatchObject({ calls: "4", weighted: "48,540" });
      for (const words of ["leading the turn", "a sub-agent's work", "a job"]) expect(text).toContain(words);
      // The lore of the chat's prompt: 8,000 of the 23,720 tokens the parts of these requests hold.
      expect(shown.row("parts", "prompt\u0000lore")).toEqual({ calls: "4", chars: "32,000", tokens: "8,000", share: "34%" });
      for (const part of ["its opening block", "the chat's prompt: lore", "the briefing: world-state", "tool results: delegate", "given by name: story:brief", "its brief"]) expect(text).toContain(part);
      // The weights, and that they are one provider's terms.
      expect(text).toContain("a token sent fresh counts 1, one read from the provider's cache 0.1, one written to it 1.25 (2 where its call asked the cache's long lifetime), and one the model wrote 5");
      expect(text).toContain("other providers' terms differ");
      expect(text).toContain("never money");
      expect(text).not.toMatch(/\$|USD|dollar|cents?\b|price|cost|spend less|fewer calls|too many/i);
      // Of the chat the page is on; every chat's is one press away, and then the sums by chat show, by the chat's name.
      expect(text).not.toContain("By chat");
      await shown.press("Every chat");
      expect(shown.text()).toContain("By chat");
      expect(shown.row("chats", CHAT)).toMatchObject({ calls: "8", weighted: "70,490", share: "100%" });
      expect(shown.text()).toContain("The salt marsh");
      await shown.close();
    }
  });

  test("a span is set against the span before it, and says what grew and what shrank", async () => {
    const p = await played();
    const shown = await drawn(p, "drawer");
    await shown.type("1");
    // The newest turn alone, then the turn received before it.
    expect(shown.asked.slice(-2).map((a) => a.query)).toMatchObject([{ turns: 1 }, { turns: 1, to: T0 + 5 * HOUR - 500 }]);
    const text = shown.text();
    expect(text).toContain("The turn played last");
    expect(text).toContain("set against the 1 turn before it");
    // The landing's turn weighs 32,720 against the ferry's 37,770 with its job.
    expect(shown.whole("weighted")).toBe("32,720");
    expect(text).toContain(`Against the span before: ${changeWords(32_720, 37_770)}.`);
    expect(changeWords(32_720, 37_770)).toBe("−5,050 (−13%)");
    expect(changeWords(100_000, 100_500)).toBe("−500 (under 1%)");
    // By agent: the Author and the GM spent the same, the place agent is new, and the historian's job is gone.
    expect(shown.marked("data-movers").map((el) => [el.getAttribute("data-movers"), el.textContent])).toContainEqual(["agents", "Grew most: place, +1,450 weighed. Shrank most: historian, −6,500 weighed."]);
    expect(shown.row("agents", "author").against).toBe("the same");
    expect(shown.row("agents", "place").against).toBe("new (+1,450)");
    expect(shown.row("agents", "historian")).toEqual({ calls: "0", input: "0", cacheRead: "0", cacheWrite: "0", output: "0", weighted: "0", share: "", against: "gone (−6,500)" });
    expect(shown.row("operations", "job").against).toBe("gone (−6,500)");
    // By part, in tokens by RPH's own estimate: the place agent's opening block (900) and brief (60) came, the job's (800 and 100) went.
    expect(shown.marked("data-movers").map((el) => [el.getAttribute("data-movers"), el.textContent])).toContainEqual(["parts", "Grew most: its opening block, +100 tokens. Shrank most: its brief, −40 tokens."]);
    expect(shown.row("parts", "opening\u0000")).toEqual({ calls: "4", chars: "19,600", tokens: "4,900", share: "41%", against: "+100 (+2%)" });
    expect(shown.row("parts", "brief\u0000").against).toBe("−40 (−31%)");
    expect(shown.row("parts", "prompt\u0000lore").against).toBe("the same");
    // What is typed that is no span is said, and the span shown stays.
    await shown.type("none");
    expect(shown.text()).toContain("A span is a whole number of at least 1: 1 turn is shown.");
    // Days: today and the days before it, and as many days before those.
    await shown.press("Last days");
    const asked = shown.asked.slice(-2).map((a) => a.query as { from: number; to?: number });
    expect(asked[0]?.to).toBeUndefined();
    expect(asked[1]?.to).toBe(asked[0]?.from);
    expect((asked[0]?.from ?? 0) - (asked[1]?.from ?? 0)).toBeGreaterThanOrEqual(7 * DAY - HOUR);
    expect(shown.text()).toContain("Today and the 6 days before it");
    await shown.close();
  });

  test("a weight changed in the settings changes the weighted figure at the next read, with the page's word on the weights", async () => {
    const p = await played();
    const shown = await drawn(p, "web");
    expect(shown.whole("weighted")).toBe("70,490");
    expect(shown.row("agents", "author").weighted).toBe("48,540");
    // A token the model wrote weighed 1 in place of 5: the eight calls wrote 3,550 tokens.
    p.config.text = "usage:\n  weights:\n    output: 1\n";
    await shown.press("Read again");
    expect(shown.whole("weighted")).toBe((70_490 - 4 * 3_550).toLocaleString("en"));
    expect(shown.row("agents", "author").weighted).toBe((48_540 - 4 * 1_500).toLocaleString("en"));
    expect(shown.text()).toContain("and one the model wrote 1.");
    // The tokens as counted do not move.
    expect(shown.row("agents", "author")).toMatchObject({ calls: "4", input: "37,600", output: "1,500" });
    // A connection's own weights are named beside every connection's, and weigh its calls.
    p.connections.push({ id: "harbor-id", name: "conn-harbor" });
    p.config.text = "connections:\n  harbor-id:\n    usage:\n      weights:\n        output: 0\n";
    await shown.press("Read again");
    expect(shown.text()).toContain("On conn-harbor: one read from the provider's cache 0.1, one written to it 1.25 (2 where its call asked the cache's long lifetime), and one the model wrote 0.");
    expect(shown.whole("weighted")).toBe((70_490 - 5 * 3_550).toLocaleString("en"));
    // The weights open in Settings.
    await shown.press("The weights, in Settings");
    expect(shown.gone).toEqual([{ page: "settings", chat: null, at: ["usage.weights.cacheRead"] }]);
    await shown.close();
  });

  test("the press reads in what was played before the rows were kept, says its calls carry totals alone, and names how long rows are kept where that is set", async () => {
    const p = await played();
    // A turn played a day before, whose folder keeps a trace from before RPH told a request by part; no row of its calls is kept.
    await p.played({ id: "r-old", turn: "turn-old", received: T0 - DAY - 500, traceRun: "run-old" });
    p.keeps(before(turnRecords({ turn: "turn-old", run: "run-old", job: "job-old", at: -DAY })).filter((record) => record.run !== "job-old"));
    const shown = await drawn(p, "web");
    expect(shown.whole("calls")).toBe("8");
    // Rows kept for good: nothing is said of how long.
    expect(shown.marked("data-kept")).toEqual([]);
    await shown.press("Read them in");
    expect(shown.asked.map((a) => a.key)).toContain("POST /api/v1/usage/read-in");
    expect(shown.text()).toContain("Read 1 turn folder and 0 jobs: 3 calls added, 3 of them with their totals alone, and 0 items handed to agents.");
    // The page read the span again: the calls read in are among it, and it says the parts are of the others.
    expect(shown.whole("calls")).toBe("11");
    expect(shown.text()).toContain("3 calls of the 11 here carry their totals alone: read in from traces kept before requests were told by part. The parts below are of the other 8.");
    // Where rows are kept for a number of days alone, the setting's name and its value stand beside the press.
    p.config.text = "usage:\n  rowsKeptDays: 30\n";
    await shown.press("Read again");
    expect(shown.marked("data-kept").map((el) => el.textContent)).toEqual(["Rows of model calls kept: 30 days. Rows of calls older than that, read in now, are removed at the next turn's end."]);
    await shown.press("Read them in");
    expect(shown.text()).toContain("Nothing was left to read in");
    await shown.close();
  });
});

/** The ferry's turn as a read of it answers, for the Turn page: its one run under RPH's id, its reply released between the GM's call and the Author's second. */
function ferryTurn(use: TurnUseReply): TurnReply {
  const turn = turnAt();
  const timings = { ...turn.timings, received: T0 - 500, started: T0, firstWord: T0 + 6_050, released: T0 + 6_100, ended: T0 + 9_202 };
  const jobs = use.jobs.flatMap((job) => (job.job === null ? [] : [job.job]));
  return { ...turn, id: TURN, timings, jobs, weighted: { runs: use.spent.weighted, jobs: Object.fromEntries(use.jobs.map((job) => [job.id, job.spent.weighted])) }, runs: turn.runs.map((run) => ({ ...run, run: RUN, timings })) };
}

function turnView(turn: TurnReply, over: Partial<TurnViewProps>): { text: string; tree: unknown } {
  const none = (): void => undefined;
  const props: TurnViewProps = { turn, runs: runsOf(applyRead(EMPTY_LIVE, turn), turn.id), problem: null, now: turn.timings.ended ?? 0, gateOpen: true, folder: NO_FOLDER, onOpenGate: none, onCloseGate: none, onBack: none, onLive: none, onRead: none, onOpenFile: none, onOpenRequest: none, onCloseFile: none, ...over };
  const tree = expand(h(TurnView, props));
  return { text: textOf(tree).replace(/\s+/g, " "), tree };
}

describe("where a turn's tokens went, on the Turn page", () => {
  test("its calls by agent and by part, with what each agent was handed, a call after the reply and a cold write marked, and its job with its own use", async () => {
    const p = await played();
    const use = await p.use(TURN);
    const turn = ferryTurn(use);
    expect(TURN_SECTIONS.find((section) => section.id === "where-tokens")).toMatchObject({ title: "Where the tokens went", spoiler: true });
    const { text, tree } = turnView(turn, { use });
    const sectionDrawn = (drawing: unknown): boolean => elements(drawing).some((e) => e.props["data-section"] === "where-tokens");
    expect(sectionDrawn(tree)).toBe(true);
    // Each agent with what its calls add up to and what they weigh.
    const agents = elements(tree).filter((e) => e.props["data-agent"] !== undefined);
    expect(agents.map((e) => textOf(e.props.children).replace(/\s+/g, " "))).toEqual([
      `author${tokensWeighed(2, { input: 18_800, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 750, reasoning: 120 }, 24_270)}1 call after the reply1 cold write`,
      `gm${tokensWeighed(1, { input: 4_000, cacheRead: 0, cacheWrite: 0, output: 600 }, 7_000)}`,
      `historian${tokensWeighed(1, { input: 2_500, cacheRead: 0, cacheWrite: 0, output: 800 }, 6_500)}`,
    ]);
    // What each was handed as it started, with who chose it.
    expect(text).toContain("briefing 1,900 (its definition's) · prompt:* 5,200 (its definition's); 7,100 tokens in all, by RPH's own estimate.");
    expect(text).toContain("world:scene(full, map) 2,100 (its definition's) · story:brief 400 (its caller's)");
    // Call by call, part by part.
    const calls = elements(tree).filter((e) => e.type === "li" && e.props["data-call"] !== undefined);
    expect(calls).toHaveLength(4);
    const first = textOf(calls[0]?.props.children).replace(/\s+/g, " ");
    expect(first).toContain("Call 1");
    expect(first).toContain("leading the turn");
    expect(first).toContain("model-gull on conn-harbor, high effort");
    expect(first).toContain("9,000 in (8,200 written to it for its long lifetime) · 300 out (120 reasoning) · weighs 18,700 · asked the cache's long lifetime");
    expect(first).toContain("its opening block 1,500 · the chat's prompt: lore 2,000 · the briefing: world-state 1,900 (tokens by RPH's own estimate)");
    // The Author's second call went out after the reply was released, and read nothing from a cache it had written: both are marked, the cold write with why.
    expect(calls.map((e) => [e.props["data-call"], e.props["data-after-reply"] ?? "no", e.props["data-cold"] ?? "no"])).toEqual([
      [1, "no", "no"],
      [2, "yes", "changed"],
      [1, "no", "no"],
      [1, "no", "no"],
    ]);
    const second = textOf(calls[1]?.props.children).replace(/\s+/g, " ");
    expect(second).toContain("after the reply");
    expect(second).toContain("cold write: what the cache is keyed on changed");
    expect(second).toContain("2.2 s after its last request ended");
    expect(second).toContain("tool results: delegate 600");
    expect(textOf(calls[2]?.props.children)).toContain("for Can the ferry cross tonight?");
    // The job it started, beside the turn, with its own use.
    expect(text).toContain("The jobs it started, each with its own use");
    expect(text).toContain("Job: historian");
    expect(text).toContain("Tally the tide tables.");
    // The turn's own runs together, the weights, and that other providers' terms differ; never money.
    expect(text).toContain(`Its own runs, every agent together${tokensWeighed(3, { input: 22_800, cacheRead: 8_200, cacheWrite: 9_100, cacheWriteLong: 9_100, output: 1_350, reasoning: 120 }, 31_270)}31,270`);
    expect(text).toContain("other providers' terms differ");
    expect(text).not.toMatch(/\$|USD|dollar|price|cost/i);

    // It names the agents: with the spoiler gate shut none of it shows, and the turn's own figures still do.
    const shut = turnView(turn, { use, gateOpen: false });
    expect(sectionDrawn(shut.tree)).toBe(false);
    expect(shut.text).not.toContain("historian");
    expect(shut.text).not.toContain("Handed as it started");
    expect(textOf(elements(shut.tree).find((e) => e.props["data-weighs"] !== undefined)?.props.children)).toBe("31,270");
    expect(shut.text).toContain("The jobs its runs started, each with its own use, which is not among the turn's.");
    expect(shut.text).toContain("done2,500 in · 800 out · weighs 6,5001 call");
  });

  test("a turn none of whose calls is kept says so, and one whose rows were read in says each call carries its totals alone", async () => {
    const p = await played();
    await p.played({ id: "r-old", turn: "turn-old", received: T0 - DAY - 500, traceRun: "run-old" });
    p.keeps(before(turnRecords({ turn: "turn-old", run: "run-old", job: "job-old", at: -DAY })).filter((record) => record.run !== "job-old"));
    const none = await p.use("turn-old");
    expect(turnView(ferryTurn(none), { use: none }).text).toContain("No row of this turn's model calls is kept");
    expect(turnView(ferryTurn(none), { use: null }).text).toContain("Reading the turn's calls…");
    await p.readIn();
    const read = await p.use("turn-old");
    const { text } = turnView(ferryTurn(read), { use: read });
    expect(text).toContain("Its row holds its totals alone");
    expect(text).toContain("not named (kept before RPH told it)");
    // Each of its three calls, the Author's two and the GM's.
    expect(elements(turnView(ferryTurn(read), { use: read }).tree).filter((e) => e.props["data-totals-only"] !== undefined)).toHaveLength(3);
  });

  test("the turn's line has what its calls weigh and its jobs beside it, with no agent named", async () => {
    const p = await played();
    const use = await p.use(TURN);
    const turn = ferryTurn(use);
    const row: TurnRow = summaryOf(turn);
    const tree = expand(h(TurnsView, { turns: [row], more: false, loading: false, problem: null, onOpen: () => undefined, onMore: () => undefined }));
    const line = elements(tree).find((e) => e.props["data-turn"] === TURN);
    const words = textOf(line?.props.children).replace(/\s+/g, " ");
    expect(words).toContain("weighs 31,270");
    expect(textOf(elements(tree).find((e) => e.props["data-turn-jobs"] !== undefined)?.props.children)).toBe("The job it started: 1 call · 2,500 in · 800 out · weighs 6,500");
    expect(words).not.toContain("historian");
    expect(row.weighted).toEqual({ runs: 31_270, jobs: { [JOB]: 6_500 } });
  });
});

/** An agent's line: its calls, its tokens, and what they weigh, as the pages word a sum. */
function tokensWeighed(calls: number, tokens: TokensCounted, weighs: number): string {
  return `${calls} ${calls === 1 ? "call" : "calls"} · ${tokensLine(tokens)} · weighs ${weighs.toLocaleString("en")}`;
}

describe("the preview's stand-in answers", () => {
  const held = (shape: AnyShape, reply: unknown): string[] => problemsOf(shape, JSON.parse(JSON.stringify(reply)), "reply");

  test("are what the routes' declarations take, and add up", () => {
    const turn = turnAt();
    const use = turnUse(turn);
    expect(held(turnUseReply, use)).toEqual([]);
    for (const span of [SPAN, SPAN_BEFORE, usageSpan({ turns: 20, from: null, to: null }), usageSpan({ turns: null, from: 1, to: 2 })]) expect(held(usageReply, span)).toEqual([]);
    expect(held(readInReply, READ_IN)).toEqual([]);
    // The turn's use is its own trace's calls, call for call, and the job it started has a call that wrote the cache again.
    expect(use.spent).toMatchObject({ calls: turn.usage.calls, input: turn.usage.input, cacheRead: turn.usage.cacheRead, output: turn.usage.output });
    expect(use.agents.map((agent) => [agent.definition, agent.plays, agent.calls.length])).toEqual([
      ["author", null, 2],
      ["gm", null, 2],
      ["character", "char-moira", 1],
    ]);
    expect(use.jobs.flatMap((job) => job.agents.flatMap((agent) => agent.calls.map((call) => call.cache?.cause ?? null)))).toEqual([null, "lapsed"]);
    // Its row tells the same: the job, and what the kept calls weigh.
    const row = withUse(summaryOf(turn), turn);
    expect(row.jobs.map((job) => job.id)).toEqual(use.jobs.map((job) => job.id));
    expect(row.weighted).toEqual({ runs: use.spent.weighted, jobs: Object.fromEntries(use.jobs.map((job) => [job.id, job.spent.weighted])) });
    // Each cut of the span adds up to its whole.
    for (const cut of [SPAN.byDefinition, SPAN.byOperation, SPAN.byChat, SPAN.byDay]) expect(cut.reduce((sum, each) => sum + each.spent.weighted, 0)).toBe(SPAN.total.weighted);
    expect(SPAN.total.calls - SPAN.withParts).toBe(9);
  });
});
