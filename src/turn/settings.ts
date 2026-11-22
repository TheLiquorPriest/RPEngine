// The turn lane's settings (plan §5.4 "Config", Appendix D.1), from the config files of the chat's
// levels (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, mapping by mapping. Each is a setting with a default, declared in `TURN_SETTINGS`, which
// the reader takes every value through and the Settings page lists; the defaults are here and nowhere
// else. A value a setting does not take is logged with its file and passed over, and the default
// holds; it never stops a turn.
//
//   turn:
//     lead: null                 the agent definition that leads a turn, RPH's setting; the shipped RPE-global.yml names it
//                                (author), and nothing in code does: with no level naming one, no turn is played
//     passConnection: <name>     the connection a request with no tag is passed on to (global level only;
//                                absent: the default connection)
//     maxRequestChars: 2000      the most characters a request beside his words may hold
//   sessions:
//     carry: continuing          what a session carries between turns: continuing, records or nothing
//   limits:
//     previousRunSeconds: ~      seconds a turn waits for the run of the turn before it, then stops it; none: until it ends
//   history:
//     hiddenReadable: false      agents may read the messages the player hid from the prompt
//     window: 40                 the latest this many of the chat's messages stay in the prompt; null keeps them all
//     step: null                 lets the window grow by this many before it is cut back to its size; null is off
//     hold: false                keeps a message the story record does not cover in the prompt: true or false,
//                                or { on: true, maxMessages: 40 }, maxMessages being the most it holds past the window
//   briefing:
//     editedTokens: null         tokens the briefing's "Since the last turn" spends on replies edited after their
//                                turns, told in full, the newest first; the rest named in one line; null tells all
//     deletedTokens: 1000        tokens it spends quoting the first words of the replies of turns a delete took; the rest
//                                by message numbers in one line
//     deletedWords: 24           words of each such reply it quotes
//     notAppliedTokens: 1500     tokens it spends listing what no longer applies after a flip; past it, a count
//     jobTokens: 1500            tokens it spends listing, thing by thing, what each finished job changed; past it, a count
//     jobReportChars: 1500       characters of each finished job's report it carries; past them, job_read reads the rest
//   reply:
//     lastText: false            a turn that ends with no reply sends the Author's last plain text in place of the error line
//   tools:
//     receiptTokens: 1500        tokens a tool that writes answers with at most, as a receipt: what it wrote, under which ids, and what
//                                did not add up; the whole answer is kept in a file of the turn the receipt names; null: every tool
//                                answers whole
//   lore:
//     choiceStands: false        the lore entries the Author let go last turn, whose text has not changed since, start the next turn
//                                let go, each as its one line, to come back whole when it asks; false: every turn starts with every
//                                entry whole
//   usage:
//     rowsKeptDays: ~            days the row of each model call is kept (global level only); null: for good
//     weights:                   what each kind of token counts in the weighted figure, a token sent fresh counting 1 (global
//                                level only); shipped as the terms of one provider, and a connection can have its own under
//                                connections.<connection>.usage.weights
//       cacheRead: 0.1           a token read from the provider's cache
//       cacheWrite: 1.25         a token written to it
//       cacheWriteLong: 2        a token written to it by a call that asked the cache's long lifetime
//       output: 5                a token the model wrote
//
// With them, the settings of the areas the turn lane hands a chat's work to, each group declared by its
// area (`cast:`, `story:`, `worldState:`, `engine:`): read here for the chat, at every level. The areas
// the lane makes once for every chat (the store, the lore and its index, the story's facts) are given
// theirs from the levels every chat shares (`globalConfig`), when RPE starts. Every value is read
// through the one reader of the config levels (`src/app/config-read.ts`), which logs what it passes over.

import type { Carry, FilesPort, LanePermission, Log, Scope } from "rp-harness/contract";
import { type ConfigRead, diskTextsNow, portTexts, readConfig } from "../app/config-read";
import type { Setting } from "../app/setting-list";
import { CAST_DEFAULTS, CAST_SETTING_DEFS, type CastSettings } from "../cast";
import { IFACE_DEFAULTS, IFACE_SETTING_DEFS, type IfaceSettings } from "../iface";
import { MAP_DEFAULTS, MAP_SETTINGS, type MapConfig, mapConfigRead } from "../iface/map";
import { WORLD_STATE_DEFAULTS, WORLD_STATE_SETTING_DEFS, type WorldStateSettings } from "../store";
import { TAP_DEFAULTS, TAP_SETTINGS, type TapSettings, tapSettingsRead } from "../play/settings";
import { PLACES_DEFAULTS, PLACES_SETTING_DEFS, type PlacesSettings } from "../places";
import { QUESTS_DEFAULTS, QUESTS_SETTING_DEFS, type QuestsSettings } from "../quests/settings";
import { STORY_DEFAULTS, STORY_SETTING_DEFS, STORY_SETTINGS_RETIRED, STORY_SO_FAR_SETTING_DEFS, type StorySettings } from "../story";
import { STORY_SO_FAR_DEFAULTS, type StorySoFarSettings } from "../story/sofar";
import { WINDOW_DEFAULTS, type WindowSettings } from "../story/window";
import { sharedLevels } from "../tree";
import type { UsageWeights, Weights } from "./usage";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";

/** RPH's room kept for the answer (`compaction.reserveTokens`), declared by RPH alone: the room the door's trim leaves a reply whose request names none. */
const RESERVE =
  RPH_SETTINGS.find((s) => s.key === "compaction.reserveTokens") ??
  (() => {
    throw new Error("rp-harness declares no compaction.reserveTokens setting.");
  })();

/** The agent definition that leads a turn (`turn.lead`), declared by RPH alone (its jobs read it too): RPE reads it for each turn. */
const LEAD =
  RPH_SETTINGS.find((s) => s.key === "turn.lead") ??
  (() => {
    throw new Error("rp-harness declares no turn.lead setting.");
  })();

/** RPH's ratio of characters to a token (`tokens.charsPerToken`), at which its model layer counts a prompt (`ModelsApi.count`): every budget a turn fills is counted at it. */
const CHARS_PER_TOKEN =
  RPH_SETTINGS.find((s) => s.key === "tokens.charsPerToken") ??
  (() => {
    throw new Error("rp-harness declares no tokens.charsPerToken setting.");
  })();

export interface TurnSettings {
  /** The agent definition that leads a turn, as the config names it; null where no level does, and no turn is played. */
  lead: string | null;
  carry: Carry;
  /** How long a turn waits for the previous turn's run, in milliseconds; null: until it ends. */
  previousRunMs: number | null;
  hiddenReadable: boolean;
  /** A turn that ends with no reply sends the Author's last plain text to Lumiverse in place of the error line (plan §10.7). */
  lastText: boolean;
  /** Tokens the replies edited after their turns may take in full in a briefing; null for no bound. */
  editedBudget: number | null;
  /** Tokens the briefing spends quoting the first words of the replies of turns a delete took. */
  deletedBudget: number;
  /** Words of each deleted turn's reply the briefing quotes. */
  deletedWords: number;
  /** Tokens the briefing spends listing what no longer applies after a flip. */
  notAppliedBudget: number;
  /** Tokens the briefing spends listing what each finished job changed, change by change. */
  jobBudget: number;
  /** Characters of each finished job's report the briefing carries; the rest is read with `job_read`. */
  jobReport: number;
  /** The history window (`src/story/window`). */
  window: WindowSettings;
  /** The cast's tools and views, for the chat. */
  cast: CastSettings;
  /** The story's tools, for the chat. */
  story: StorySettings;
  /** What a place's answers and lines show, for the chat (`places.*`, registered by the story's area). */
  places: PlacesSettings;
  /** What the quests' answers and records page show, for the chat (`quests.*`). */
  quests: QuestsSettings;
  /** The story so far in the briefing. */
  storySoFar: StorySoFarSettings;
  /** The world state in the briefing. */
  worldState: WorldStateSettings;
  /** The engine's tools, for the chat. */
  engine: IfaceSettings;
  /** The map's settings, for the chat. */
  map: MapConfig;
  /** RPH's room kept for the answer, in tokens (`compaction.reserveTokens`). */
  reserve: number;
  /** RPH's characters to a token for the chat (`tokens.charsPerToken`), the model layer's count: every budget the turn fills is counted at it. */
  charsPerToken: number;
  /** The turns a chat's list gives when the page names no limit (`turns.page`), and the most one page may ask (`turns.maxPage`). */
  turnsPage: { size: number; most: number };
  /** The most characters a request's words may hold (`turn.maxRequestChars`); one past it is not kept. */
  requestsTextMost: number;
  /** The taps' bounds, for the chat (`src/play/settings.ts`). */
  taps: TapSettings;
  /** Whose messages are the chat's story (`story.from`), and, read with `replies`, whether his newest message is the turn's direction (`story.newest`): briefing facts (R-176). */
  storyFrom: StoryFrom;
  storyNewest: StoryNewest;
  /** The most characters of a gap check's hit in the state or the story record (`tools.gap.snippetChars`). */
  gapSnippet: number;
  /** Tokens a tool that writes answers with at most, as a receipt whose whole answer is kept in a file of the turn (`tools.receiptTokens`, plan §5.2); null: every tool answers whole. */
  receiptTokens: number | null;
  /** Whether the lead's choice of the lore stands into the next turn (`lore.choiceStands`, plan 3.2 §6.1): the entries it let go last turn, their text unchanged, start the turn let go. */
  choiceStands: boolean;
  /** What a write to each lane does (`permissions.<lane>`), and a call of a tool outside RPE (`external`): the user's, per chat, read at every level. */
  permissions: Readonly<Record<"story" | "engine" | "external", LanePermission>>;
}

/** Whose messages are the story: as Lumiverse has it, everyone's, or the replies alone (R-176). */
export type StoryFrom = "lumiverse" | "everyone" | "replies";
/** With the replies as the story, his newest message: the turn's direction, or left out. */
export type StoryNewest = "directive" | "leave_out";
export const STORY_FROM: readonly StoryFrom[] = ["lumiverse", "everyone", "replies"];
export const STORY_NEWEST: readonly StoryNewest[] = ["directive", "leave_out"];
/** What a lane's writes may be set to, as the contract names them. */
export const LANE_PERMISSIONS: readonly LanePermission[] = ["auto", "confirm", "never"];

/** The defaults, where no level sets a value. */
export const TURN_DEFAULTS: Readonly<TurnSettings> = Object.freeze({
  // Plan §13.1, §17.2: who leads is the shipped config's line (`RPE-global.yml` `turn.lead: author`), never code's choice.
  lead: null,
  // Appendix D.1: continuing, until the session measurement says otherwise.
  carry: "continuing",
  // §2.1 point 4 (17 Nov): the next turn waits for the previous turn's run to end.
  previousRunMs: null,
  // Appendix D.1: as today's setting, which is off.
  hiddenReadable: false,
  // Appendix D.1: "When the Author ends with no reply: a plain error line in Lumiverse".
  lastText: false,
  // Plan §6.3 l.628: every edited reply is told with its old and new text whole, however many a carried chat brings to its first turn.
  // A bound is his to set, off as shipped.
  editedBudget: null,
  // PlanTurnKinds-3: the turns a delete took, quoted while they fit; what a flip stopped, listed while it fits.
  deletedBudget: 1000,
  deletedWords: 24,
  notAppliedBudget: 1500,
  // PlanTurnKinds-5: what each finished job changed, listed while it fits; the rest counted, and all of it on the Jobs page.
  jobBudget: 1500,
  // A finished job's report is the job's own accounting, of any length: an ordinary one (a paragraph or two) is carried whole, a long one
  // cut, the line naming job_read for the rest. Its brief is the starter's own words, never told back.
  jobReport: 1500,
  // Appendix D.1, as the window's own module keeps them.
  window: WINDOW_DEFAULTS,
  // Appendix D.1, as each area keeps its own.
  cast: CAST_DEFAULTS,
  story: STORY_DEFAULTS,
  places: PLACES_DEFAULTS,
  quests: QUESTS_DEFAULTS,
  storySoFar: STORY_SO_FAR_DEFAULTS,
  worldState: WORLD_STATE_DEFAULTS,
  engine: IFACE_DEFAULTS,
  map: MAP_DEFAULTS,
  // RPH's own default.
  reserve: RESERVE.default as number,
  charsPerToken: CHARS_PER_TOKEN.default as number,
  // The first build's fixed page sizes, made settings.
  turnsPage: { size: 50, most: 500 },
  requestsTextMost: 2000,
  taps: TAP_DEFAULTS,
  // R-176: today's values, carried.
  storyFrom: "lumiverse",
  storyNewest: "directive",
  gapSnippet: 240,
  // The plan's §5.2: a receipt of a call of a few dozen operations, its ids and its report lines, fits it; the answers it replaces ran to tens of thousands of characters.
  receiptTokens: 1500,
  // The plan's §6.1: off as shipped, so a turn starts with every activated entry whole unless the user says the Author's choice stands.
  choiceStands: false,
  // Appendix D.1: "Write permission, each lane: Auto"; the external tier has its own, with the same three values.
  permissions: { story: "auto", engine: "auto", external: "auto" } satisfies TurnSettings["permissions"],
});

const CARRIES: readonly Carry[] = ["continuing", "records", "nothing"];

/** Each setting as the files write it, by the name this file reads it under. Each is in force from the next turn, but the connection for requests with no tag, read at each. */
const DEFS = {
  carry: {
    key: "sessions.carry",
    default: TURN_DEFAULTS.carry,
    takes: { type: "oneOf", values: CARRIES },
    perConnection: false,
    name: "Context carried in a session",
    about: "What a session carries between turns: continuing, records or nothing.",
    effect: "turn",
    row: "How context is carried in a session",
  },
  previousRun: {
    key: "limits.previousRunSeconds",
    default: null,
    takes: { type: "number", least: 0 },
    orNone: true,
    none: "until it ends",
    perConnection: false,
    name: "Wait for the previous run",
    about: "Seconds a turn waits for the run of the turn before it; then that run is stopped. None: it waits until that run ends.",
    effect: "turn",
    row: "Wait for the previous turn's run",
  },
  hiddenReadable: {
    key: "history.hiddenReadable",
    default: TURN_DEFAULTS.hiddenReadable,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "Hidden messages readable",
    about: "Agents may read the messages you hid from the prompt.",
    effect: "turn",
    row: "Hidden messages readable by agents",
  },
  lastText: {
    key: "reply.lastText",
    default: TURN_DEFAULTS.lastText,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "Last text as the reply",
    about: "A turn that ends with no reply sends the Author's last plain text in place of the error line.",
    effect: "turn",
    row: "When the Author ends with no reply",
  },
  editedBudget: {
    key: "briefing.editedTokens",
    default: TURN_DEFAULTS.editedBudget,
    takes: { type: "whole", least: 0 },
    orNone: true,
    none: "every one in full",
    perConnection: false,
    name: "Edited replies in the briefing",
    about: "Off as shipped, every edited reply is told with both its texts whole. Set, the tokens the briefing spends on replies edited after their turns, told in full, the newest first; the rest are named by message in one line, with no text.",
    effect: "turn",
  },
  deletedBudget: {
    key: "briefing.deletedTokens",
    default: TURN_DEFAULTS.deletedBudget,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "Deleted turns in the briefing",
    about: "The tokens the briefing spends naming the turns a delete took with the first words of each one's reply, the newest first; the rest are named by message number in one line.",
    effect: "turn",
  },
  deletedWords: {
    key: "briefing.deletedWords",
    default: TURN_DEFAULTS.deletedWords,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Words quoted of a deleted turn",
    about: "How many of the first words of each deleted turn's reply the briefing quotes to name it.",
    effect: "turn",
  },
  notAppliedBudget: {
    key: "briefing.notAppliedTokens",
    default: TURN_DEFAULTS.notAppliedBudget,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "What a flip stopped, in the briefing",
    about: "The tokens the briefing spends listing, change by change, what no longer applies after an earlier reply was flipped to another swipe; past them the rest are counted, and the world state lists them.",
    effect: "turn",
  },
  jobBudget: {
    key: "briefing.jobTokens",
    default: TURN_DEFAULTS.jobBudget,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "What a finished job changed, in the briefing",
    about: "The tokens the briefing spends on each finished job's changes, thing by thing, with why one did not take effect; past them the rest are counted, and the Jobs page lists them all.",
    effect: "turn",
  },
  jobReport: {
    key: "briefing.jobReportChars",
    default: TURN_DEFAULTS.jobReport,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "A finished job's report, in the briefing",
    about: "How many characters of each finished job's report the next briefing carries; past them the line names job_read, which reads the report whole. The job's brief is not told again: the one who started it wrote it.",
    effect: "turn",
  },
  window: {
    key: "history.window",
    default: TURN_DEFAULTS.window.size,
    takes: { type: "whole", least: 1 },
    orNone: true,
    none: "every message kept",
    perConnection: false,
    name: "History window",
    about: "The latest this many of the chat's messages stay in the prompt.",
    effect: "turn",
    row: "History window",
  },
  step: {
    key: "history.step",
    default: TURN_DEFAULTS.window.step,
    takes: { type: "whole", least: 1 },
    orNone: true,
    none: "off",
    perConnection: false,
    name: "Window step",
    about: "Lets the window grow by this many messages before it is cut back to its size.",
    effect: "turn",
    row: "The window's step",
  },
  // `hold: true` is `hold: { on: true }`, its cap the default.
  holdOn: {
    key: "history.hold.on",
    default: TURN_DEFAULTS.window.hold.on,
    takes: { type: "yesNo" },
    short: true,
    perConnection: false,
    name: "Hold uncovered messages",
    about: "Keeps a message the story record does not cover yet in the prompt.",
    effect: "turn",
    row: "Hold a message in the prompt until the record covers it",
  },
  holdCap: {
    key: "history.hold.maxMessages",
    default: TURN_DEFAULTS.window.hold.cap,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "Hold's most",
    about: "The most messages the hold keeps past the window.",
    effect: "turn",
    row: "Hold a message in the prompt until the record covers it",
  },
  // Read with no chat (`passConnection` below), so from the global level alone.
  passConnection: {
    key: "turn.passConnection",
    default: null,
    takes: { type: "text" },
    orNone: true,
    none: "the default connection",
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Connection for requests with no tag",
    about: "The connection a request with no tag is passed on to.",
    effect: "use",
  },
  turnsPage: {
    key: "turns.page",
    default: 50,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Turns on a page",
    about: "The turns a chat's list on the Turn page gives when the page names no number.",
    effect: "use",
  },
  turnsPageMost: {
    key: "turns.maxPage",
    default: 500,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Most turns on a page",
    about: "The most turns one page of a chat's list may ask for.",
    effect: "use",
  },
  jobsPage: {
    key: "jobs.page",
    default: 50,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Jobs on a page",
    about: "The jobs a list of jobs gives when the page names no number, each by its line; a page reads a job whole when it opens it.",
    effect: "use",
  },
  jobsPageMost: {
    key: "jobs.maxPage",
    default: 500,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Most jobs on a page",
    about: "The most jobs one page of a list of jobs may ask for.",
    effect: "use",
  },
  usageRowsKept: {
    key: "usage.rowsKeptDays",
    default: null,
    takes: { type: "whole", least: 0 },
    advice: [{ below: 7, says: "Under a week of rows the Usage page has no earlier week to compare a week with; at 0 every row goes as its turn ends, and the pages that read them show nothing." }],
    orNone: true,
    none: "kept for good",
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Rows of model calls kept",
    about: "Days RPE keeps the row of each model call (its tokens, its request by part, what it asked of the provider's cache) and of what each agent was handed, which the Usage page and a turn's use read. After a turn, the rows of calls that began longer ago are removed; what each run spent in all stays with its turn. None: the rows are kept for good.",
    effect: "use",
  },
  requestsTextMost: {
    key: "turn.maxRequestChars",
    default: TURN_DEFAULTS.requestsTextMost,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Longest request",
    about: "The most characters a request may hold beside your words (what was pressed and on what, or a composer control's choice and words); one past it is not kept, and the answer says so.",
    effect: "use",
  },
  storyFrom: {
    key: "story.from",
    default: TURN_DEFAULTS.storyFrom,
    takes: { type: "oneOf", values: STORY_FROM },
    perConnection: false,
    name: "Whose messages are the story",
    about: "Whose messages the chat's story is made of: as Lumiverse has it (lumiverse), everyone's, or the replies alone (replies). A briefing fact the guidance reads.",
    effect: "turn",
  },
  storyNewest: {
    key: "story.newest",
    default: TURN_DEFAULTS.storyNewest,
    takes: { type: "oneOf", values: STORY_NEWEST },
    perConnection: false,
    name: "Your newest message",
    about: "With the story made of the replies: whether your newest message is the turn's direction (directive) or left out (leave_out). A briefing fact the guidance reads.",
    effect: "turn",
  },
  gapSnippet: {
    key: "tools.gap.snippetChars",
    default: TURN_DEFAULTS.gapSnippet,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Gap check hit length",
    about: "The most characters of a gap check's hit in the world state or the story record that the agent reads and the evidence keeps.",
    effect: "turn",
  },
  receiptTokens: {
    key: "tools.receiptTokens",
    default: TURN_DEFAULTS.receiptTokens,
    takes: { type: "whole", least: 0 },
    advice: [{ below: 100, says: "Under 100 tokens a receipt of more than a few operations leaves their ids to the file, and the agent opens the file for them." }],
    orNone: true,
    none: "every tool answers whole",
    perConnection: false,
    name: "A writing tool's receipt",
    about: "The most tokens a tool that writes answers with: a receipt of what it wrote and under which ids, with each thing that did not add up in a line. The whole answer is kept in a file of the turn, which the receipt names and the agent reads with its file tool; a receipt past the size says how many ids it left to that file, and no report line is ever cut. None: every tool answers whole, giving back what it was sent and how each thing now stands.",
    effect: "turn",
  },
  choiceStands: {
    key: "lore.choiceStands",
    default: TURN_DEFAULTS.choiceStands,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "The Author's choice of lore stands",
    about: "Each turn the Author keeps the activated lore entries its reply needs and may let the others go, each to one line it can open again. On: an entry it let go last turn, whose text has not changed since, starts the next turn let go, so it is not sent whole again; the Author brings it back whole when it wants it. Off: every turn starts with every activated entry whole. An entry that is new or whose text changed always starts whole.",
    effect: "turn",
  },
  permissionStory: {
    key: "permissions.story",
    default: TURN_DEFAULTS.permissions.story,
    takes: { type: "oneOf", values: LANE_PERMISSIONS },
    perConnection: false,
    name: "Write permission, the story lane",
    about: "What the agents' writes to the story record do: go ahead (auto), wait for your word on the turn's card (confirm), or are left out (never).",
    effect: "turn",
  },
  permissionEngine: {
    key: "permissions.engine",
    default: TURN_DEFAULTS.permissions.engine,
    takes: { type: "oneOf", values: LANE_PERMISSIONS },
    perConnection: false,
    name: "Write permission, the engine lane",
    about: "What the agents' writes to the world's state do: go ahead (auto), wait for your word on the turn's card (confirm), or are left out (never).",
    effect: "turn",
  },
  permissionExternal: {
    key: "permissions.external",
    default: TURN_DEFAULTS.permissions.external,
    takes: { type: "oneOf", values: LANE_PERMISSIONS },
    perConnection: false,
    name: "Permission for tools that reach outside RPE",
    about: "What a call of a tool outside RPE (the web, a command, an MCP server) does: go ahead (auto), wait for your word (confirm), or is refused (never).",
    effect: "turn",
  },
} as const satisfies Record<string, Setting>;

/**
 * One weight of the weighted figure as two settings (plan §4 "The pages show"): every connection's (`usage.weights.<of>`), shipped
 * as the terms of the provider the owner uses, and one connection's own (`connections.<connection>.usage.weights.<of>`), which
 * stands over it for that connection's calls. A weight below nothing means nothing; no other bound is put on one.
 */
function weightSettings(of: keyof Weights, shipped: number, what: string, named: string): { general: Setting; own: Setting } {
  return {
    general: {
      key: `usage.weights.${of}`,
      default: shipped,
      takes: { type: "number", least: 0 },
      levels: ["shipped", "global"],
      perConnection: false,
      name: `Weight of ${named}`,
      about: `What ${what} counts in the weighted figure the Usage page and a turn's use show beside the tokens, a token sent fresh counting 1. Shipped as the terms of one provider: another's differ, and a connection can have its own (connections.<connection>.usage.weights.${of}). The figure is worked out as a page reads it, so a change shows at once, for every row kept.`,
      effect: "use",
    },
    own: {
      key: `connections.<connection>.usage.weights.${of}`,
      default: null,
      takes: { type: "number", least: 0 },
      orNone: true,
      none: "no weight of its own",
      levels: ["shipped", "global"],
      perConnection: true,
      name: `Weight of ${named}, on a connection`,
      about: `What ${what} counts in the weighted figure for the calls made on this connection, in place of usage.weights.${of}: for a provider whose terms differ.`,
      effect: "use",
    },
  };
}

const WEIGHT_DEFS: Readonly<Record<keyof Weights, { general: Setting; own: Setting }>> = {
  cacheRead: weightSettings("cacheRead", 0.1, "a token read from the provider's cache", "a token read from the cache"),
  cacheWrite: weightSettings("cacheWrite", 1.25, "a token written to the provider's cache", "a token written to the cache"),
  cacheWriteLong: weightSettings("cacheWriteLong", 2, "a token written to the provider's cache by a call that asked its long lifetime", "a token written to the cache for its long lifetime"),
  output: weightSettings("output", 5, "a token the model wrote (its reasoning is among them)", "a token the model wrote"),
};

/** The four weights, each by what `value` gives for it. */
const weightsFrom = (value: (of: keyof Weights) => number): Weights => ({ cacheRead: value("cacheRead"), cacheWrite: value("cacheWrite"), cacheWriteLong: value("cacheWriteLong"), output: value("output") });

/** Every setting the turn lane lists, as a config file writes it: its own, the weights of the weighted figure, the map's and the taps'. `turn.lead` is RPH's, read here and listed once, by RPH. */
export const TURN_SETTINGS: readonly Setting[] = [...Object.values(DEFS), ...Object.values(WEIGHT_DEFS).flatMap((w) => [w.general, w.own]), ...MAP_SETTINGS, ...TAP_SETTINGS];

/** A list of jobs' page when the caller names none, and the most one page may ask (`jobs.page`, `jobs.maxPage`), as `read` sets them. */
export function jobsPage(read: ConfigRead): { default: number; most: number } {
  return { default: read.value(DEFS.jobsPage) as number, most: read.value(DEFS.jobsPageMost) as number };
}

/** The days the rows of model calls are kept (`usage.rowsKeptDays`), as `read` sets it at the levels every chat shares; null: for good. */
export function usageRowsKeptDays(read: ConfigRead): number | null {
  return read.value(DEFS.usageRowsKept) as number | null;
}

/** The setting that says how long the rows of model calls are kept, as a page names it beside what it does: its key, and what the Settings page calls it. */
export const USAGE_ROWS_KEPT = { key: DEFS.usageRowsKept.key, name: DEFS.usageRowsKept.name } as const;

/** The names and the ids connections are given weights of their own under, in the levels every chat shares; none where no connection has any. */
export function weighedConnections(read: ConfigRead): string[] {
  return [...new Set(Object.values(WEIGHT_DEFS).flatMap((w) => read.named(w.own)))];
}

/**
 * The weights of the weighted figure as `read` sets them at the levels every chat shares: every connection's, and those of each
 * connection that has its own, by its name, which is what the row of a call carries. A connection's own weight is the one set
 * under its id, else the one under its name, else every connection's (as RPH reads a connection's settings); a name no connection
 * in `connections` has (one since renamed or removed, whose rows still carry it) keeps the weights set under it.
 */
export function usageWeights(read: ConfigRead, connections: readonly { id: string; name: string }[]): UsageWeights {
  const general = weightsFrom((of) => read.value(WEIGHT_DEFS[of].general) as number);
  const named = new Set(weighedConnections(read));
  const under = (keys: readonly string[]): Weights => weightsFrom((of) => keys.map((key) => read.value(WEIGHT_DEFS[of].own, key) as number | null).find((value) => value !== null) ?? general[of]);
  const own = new Map<string, Weights>();
  for (const c of connections) {
    const keys = [c.id, c.name].filter((key) => named.has(key));
    if (keys.length > 0) own.set(c.name, under(keys));
  }
  const known = new Set(connections.flatMap((c) => [c.id, c.name]));
  for (const key of named) if (!known.has(key)) own.set(key, under([key]));
  return { general, connections: own };
}

/** The turn's settings for a scope, as its levels' config files set them over the defaults. */
export async function turnSettings(files: FilesPort, scope: Scope, log: Log): Promise<TurnSettings> {
  const read = readConfig(await portTexts(files, scope), log, [...TURN_SETTINGS, LEAD]);
  read.retired(STORY_SETTINGS_RETIRED);
  const previousRun = read.value(DEFS.previousRun) as number | null;
  // Each value is one its setting takes, so it is of the type the setting's `takes` says.
  return {
    lead: read.value(LEAD) as string | null,
    carry: read.value(DEFS.carry) as Carry,
    previousRunMs: previousRun === null ? null : previousRun * 1000,
    hiddenReadable: read.value(DEFS.hiddenReadable) as boolean,
    lastText: read.value(DEFS.lastText) as boolean,
    editedBudget: read.value(DEFS.editedBudget) as number | null,
    deletedBudget: read.value(DEFS.deletedBudget) as number,
    deletedWords: read.value(DEFS.deletedWords) as number,
    notAppliedBudget: read.value(DEFS.notAppliedBudget) as number,
    jobBudget: read.value(DEFS.jobBudget) as number,
    jobReport: read.value(DEFS.jobReport) as number,
    window: {
      size: read.value(DEFS.window) as number | null,
      step: read.value(DEFS.step) as number | null,
      hold: { on: read.value(DEFS.holdOn) as boolean, cap: read.value(DEFS.holdCap) as number },
    },
    cast: read.numbers(CAST_SETTING_DEFS),
    story: read.numbers(STORY_SETTING_DEFS),
    places: read.numbers(PLACES_SETTING_DEFS),
    quests: read.numbers(QUESTS_SETTING_DEFS),
    storySoFar: read.numbers(STORY_SO_FAR_SETTING_DEFS),
    worldState: read.numbers(WORLD_STATE_SETTING_DEFS),
    engine: read.numbers(IFACE_SETTING_DEFS),
    map: mapConfigRead(read),
    reserve: read.value(RESERVE) as number,
    charsPerToken: read.value(CHARS_PER_TOKEN) as number,
    turnsPage: { size: read.value(DEFS.turnsPage) as number, most: read.value(DEFS.turnsPageMost) as number },
    requestsTextMost: read.value(DEFS.requestsTextMost) as number,
    taps: tapSettingsRead(read),
    storyFrom: read.value(DEFS.storyFrom) as StoryFrom,
    storyNewest: read.value(DEFS.storyNewest) as StoryNewest,
    gapSnippet: read.value(DEFS.gapSnippet) as number,
    receiptTokens: read.value(DEFS.receiptTokens) as number | null,
    choiceStands: read.value(DEFS.choiceStands) === true,
    permissions: {
      story: read.value(DEFS.permissionStory) as LanePermission,
      engine: read.value(DEFS.permissionEngine) as LanePermission,
      external: read.value(DEFS.permissionExternal) as LanePermission,
    },
  };
}

/**
 * The levels every chat shares, the user's `RPE-global.yml` over the shipped one, read from the files as they are asked for, since what
 * reads them is made for no chat (requests with no tag; the store, the lore and the story's facts, made when RPE starts).
 */
export function globalConfig(files: string, log: Log): ConfigRead {
  return readConfig(diskTextsNow(sharedLevels(files)), log);
}

/** The connection a request with no tag is passed on to, as the global level's config names it; null for the default connection. */
export function passConnection(files: string, log: Log): string | null {
  return globalConfig(files, log).value(DEFS.passConnection) as string | null;
}
