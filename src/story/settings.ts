// The story lane's settings (plan Appendix D.1): each of its defaults as a config file writes it, under
// `story:`. The defaults stay where each part keeps them; the host (the turn lane) reads the values from
// the config files and hands them to each part, at the levels each part can take them from.

import type { NumberSettings, Setting } from "../app/setting-list";
import { STORY_FACT_DEFAULTS, type StoryFactSettings } from "./facts";
import { STORY_DEFAULTS, type StorySettings } from "./kit";
import { STORY_SO_FAR_DEFAULTS, type StorySoFarSettings } from "./sofar";

/** The story tools' (`storyTools`): read at every level, since the tools are made for the chat a call is in, at each turn. */
export const STORY_SETTING_DEFS = {
  queryItems: { key: "story.queryItems", default: STORY_DEFAULTS.queryItems, takes: { type: "whole", least: 1 }, perConnection: false, name: "Items a story query gives", about: "The most items one story_query answers with; the answer says how many more match.", effect: "turn" },
  nearMatches: { key: "story.nearMatches", default: STORY_DEFAULTS.nearMatches, takes: { type: "whole", least: 0 }, perConnection: false, name: "Near ids listed", about: "How many near ids an answer about an id the story record does not hold lists.", effect: "turn" },
  nearDistance: { key: "story.nearDistance", default: STORY_DEFAULTS.nearDistance, takes: { type: "number", least: 0 }, perConnection: false, name: "Spelling distance of a near id", about: "How far off in spelling an id may be and still be listed as a near one, as a part of its length: 0.25 lets a quarter of its letters differ.", effect: "turn" },
} as const satisfies NumberSettings<keyof StorySettings>;

/** The story's facts' (`storyFacts`): the host makes them once for every chat, when RPE starts, so they are read from the global level alone. */
export const STORY_FACT_SETTING_DEFS = {
  ahead: {
    key: "story.ahead",
    default: STORY_FACT_DEFAULTS.ahead,
    takes: { type: "whole", least: 0 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Messages ahead of a turn",
    about: "Messages the chat is taken to grow by before the next turn's prompt (this turn's reply and your next message), where the story record is measured.",
    effect: "start",
  },
} as const satisfies NumberSettings<keyof StoryFactSettings>;

/** The story so far's (`storySoFar`): read at every level, since it is worked out for each turn's briefing. */
export const STORY_SO_FAR_SETTING_DEFS = {
  tokens: { key: "story.soFar.tokens", default: STORY_SO_FAR_DEFAULTS.tokens, takes: { type: "whole", least: 0 }, perConnection: false, name: "The story so far: tokens", about: "The most tokens the briefing's story so far may fill, on every model. What does not fit is counted in the block, and the Author opens it with story_query.", effect: "turn", row: "The story so far, in the briefing" },
} as const satisfies NumberSettings<keyof StorySoFarSettings>;

/** Keys the story lane read once, each with what took its place: a config file that still sets one is read as before, and the log says so (`ConfigRead.retired`). */
export const STORY_SETTINGS_RETIRED: Readonly<Record<string, string>> = {
  "story.soFar.share": "The story so far has one size on every model now: set story.soFar.tokens.",
  "story.soFar.minTokens": "The story so far has one size on every model now: set story.soFar.tokens.",
};

/** Every setting the story lane reads, as a config file writes it. */
export const STORY_SETTINGS: readonly Setting[] = [...Object.values(STORY_SETTING_DEFS), ...Object.values(STORY_FACT_SETTING_DEFS), ...Object.values(STORY_SO_FAR_SETTING_DEFS)];
