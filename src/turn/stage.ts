// Who was on stage at a turn, and where (plan §7.3, §8.1, R-56): whoever the Author recorded in the open scene and whoever the state
// places in the scene's place; with no scene recorded, those the state places where the owner's character is; with neither, nobody,
// and the stage says it was not recorded. The first horizon entry's place is never used. The cast's facts count by it, the views an
// agent is given of the character it plays take its people, its place and its things as what is present, and what comes to mind is
// cued by them. Nothing is guessed from words but the scene's place, which is found the way the space pack finds a place named in
// play (`findPlaces`). The same scene names the stretch of the chat an agent can ask for as `scene` (`chat:history[scene]`). The cast's
// facts of what waits for a character's own agent read which scene each turn was played in and which scenes are closed at a reading.
// A character's outline of what it perceived, and its own reading of it by scene (plan 3.2 §6.4), take the scene each turn lies in from
// one reading of the record (`scenesAcross`), since the cast may not read the story: by the scene's id alone, for a title is the story
// record's words, which are the omniscient side's and never reach the character.

import type { HistoryRange } from "rp-harness/contract";
import { isGone, kindIs } from "../engine/scope";
import { findPlaces } from "../engine/places-in-play";
import { entitiesAt } from "../engine/whereabouts";
import { calendarOf, formatClock } from "../engine/calendar";
import { openScenePlaceOf, ownerPlaceOf, type Store, type StoreState } from "../store";
import { clockRecorded } from "../store/blank";
import { namesOf } from "../story/kit";
import { storyAt } from "../story/path";
import { storySliceOf } from "../story/fold";
import { StoryRecord } from "../story/record";

/** How a stage was read: from the open scene, from where the owner's character stands (no scene recorded), or not at all (neither). */
export const STAGE_READINGS = ["scene", "owner", "none"] as const;
export type StageHow = (typeof STAGE_READINGS)[number];

/** The stage at one reading: who is there by name, the place in words, the things there, and how it was read. */
export interface Stage {
  who: string[];
  /** Who the open scene's record names, the Author's own list (§7.3's "who was on stage"); none with no scene recorded. */
  named: string[];
  place: string | null;
  /** The names of what the state places at the place and on those present; none the state does not hold. */
  things: string[];
  how: StageHow;
  /** The story's date and time as the state left it there, as the world's calendar writes it; null where nobody set the clock. */
  time: string | null;
}

/**
 * Who a stage counts as on it for the cast's counts and the Turn page (plan §7.3): with a scene recorded, the Author's own list of who
 * is in it, never everyone the state places in its place (a place holds those through a wall); with none, who the state places where
 * the owner's character stands, for there is no list; with neither, nobody.
 */
export function countedOn(stage: Stage): { who: string[]; how: StageHow; place: string | null; time: string | null } {
  return { who: stage.how === "scene" ? stage.named : stage.who, how: stage.how, place: stage.place, time: stage.time };
}

/** The open scene as the story record holds it: the people it names and its place in the Author's words. */
interface Scene {
  who: string[];
  place: string | null;
}

function sceneOf(record: StoryRecord): Scene | null {
  const scene = record.current("scene");
  if (scene === null || scene.closedBy !== null) return null;
  const place = scene.fields.place;
  return { who: namesOf(scene), place: typeof place === "string" && place.trim() !== "" ? place : null };
}

const keyOf = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/** The stage from the open scene (if any) and the state the turn left: R-56. */
function stageOf(store: Store, state: StoreState, scene: Scene | null): Stage {
  const doc = store.env.worlds(state.world.revision);
  const time = doc !== undefined && clockRecorded(state) ? formatClock(calendarOf(doc), state.world.clock) : null;
  const asRecorded: Stage = { who: scene?.who ?? [], named: scene?.who ?? [], place: scene?.place ?? null, things: [], how: scene === null ? "none" : "scene", time };
  if (doc === undefined) return asRecorded;
  const reg = store.env.registry;
  // The scene's place is the one the store finds for its record (an id the tree holds); the Author's words for a place the tree has no id for are found the way the
  // space pack finds a place named in play, nearest where the owner's character stands. With no scene, that place is where he stands.
  const view = store.viewOf(state);
  const povPlace = ownerPlaceOf(view)?.slice("place:".length) ?? null;
  const opened = scene === null ? null : openScenePlaceOf(view);
  const at = scene === null ? povPlace : opened !== null ? opened.slice("place:".length) : scene.place === null ? null : (findPlaces(reg.context(doc, state.world), scene.place, povPlace === null ? {} : { near: povPlace })[0]?.id ?? null);
  if (at === null) return asRecorded;
  const who = [...asRecorded.who];
  const named = new Set(who.map(keyOf));
  const things: string[] = [];
  for (const id of entitiesAt(state.world, at)) {
    const e = state.world.entities[id];
    if (e === undefined || isGone(state.world, id)) continue;
    if (!kindIs(reg, doc, e.kind, "person")) things.push(e.name);
    // The owner's character perceives when his mind is on (`cast.playerMind`): the Author names him, the state does not add him.
    else if (id !== doc.pov && !named.has(keyOf(e.name))) {
      named.add(keyOf(e.name));
      who.push(e.name);
    }
  }
  const place = scene?.place ?? doc.places[at]?.name ?? null;
  return { who, named: asRecorded.named, place, things, how: scene !== null ? "scene" : who.length > 0 ? "owner" : "none", time };
}

/** The stage at one reading of the chat: at `turn`, or at its head when null; a chat the store does not hold has none. */
export function stageAt(store: Store, user: string, chat: string, turn: string | null): Stage | null {
  const u = store.user(user);
  if (u.chat(chat) === null) return null;
  const state = (turn === null ? u.headState(chat) : u.stateAt(turn)).state;
  return stageOf(store, state, sceneOf(new StoryRecord(storyAt(u, chat, turn), storySliceOf(state))));
}

/** The name of the stretch that is the part of the open scene the prompt's window holds (`chat:history[scene-window]`, plan 3.2 §6.6). */
export const SCENE_WINDOW = "scene-window";

/**
 * The stretches of a chat RPE names for agents (`ChatInfo.ranges`): `scene`, from the first message of the scene the story record
 * holds open at `turn`'s own reading (the chat's head for null) to the end of that line's messages, so a swipe's scene is the one its
 * parent left and never one the replaced attempt opened; and `scene-window`, the part of it the prompt held: from `kept`, the first
 * message that prompt's window kept, where that lies inside the scene, and the whole scene where the window cut nothing (null) or
 * cut before it. None while no scene is open, or for a scene whose start the record cannot place.
 */
export function namedStretches(store: Store, user: string, chat: string, turn: string | null, kept: string | null = null): Record<string, HistoryRange> {
  if (store.user(user).chat(chat) === null) return {};
  const record = StoryRecord.read(store, user, storyAt(store.user(user), chat, turn));
  const scene = record.current("scene");
  const from = scene === null || scene.closedBy !== null ? null : record.startOf(scene);
  if (from === null) return {};
  const to = record.at.messages.length;
  const keptAt = kept === null ? null : record.numberOf(kept);
  return { scene: { from, to }, [SCENE_WINDOW]: { from: keptAt === null ? from : Math.min(Math.max(from, keptAt), to), to } };
}

/**
 * The stage at each of `turns`, each read from the state the store folded at that turn, laid over the line of the deepest one so the
 * line's messages are worked out once. A turn asked for that its own reading does not hold (one the store has no line to) is left out.
 */
export function stagesAt(store: Store, user: string, chat: string, turns: readonly string[]): Map<string, Stage> {
  const out = new Map<string, Stage>();
  const u = store.user(user);
  if (u.chat(chat) === null) return out;
  const left = new Set(turns);
  for (const deepest of [...turns].reverse()) {
    if (!left.has(deepest)) continue;
    const at = storyAt(u, chat, deepest);
    for (const turn of at.turns) {
      if (!left.delete(turn)) continue;
      const state = u.stateAt(turn).state;
      out.set(turn, stageOf(store, state, sceneOf(new StoryRecord(at, storySliceOf(state)))));
    }
    left.delete(deepest);
  }
  return out;
}

/** A scene as the cast's facts name it: its id, and its title as the Author wrote it (null: none). */
export interface SceneRef {
  id: string;
  title: string | null;
}

function sceneRef(scene: { id: string; fields: Readonly<Record<string, unknown>> }): SceneRef {
  const title = scene.fields.title;
  return { id: scene.id, title: typeof title === "string" && title.trim() !== "" ? title : null };
}

/**
 * The scene each of `turns` was played in, read from the state the store folded at that turn as `stagesAt` reads it: the scene the record
 * holds open there, or the one that turn closed; null for a turn played in none. A turn its own reading does not hold is left out.
 */
export function scenesOf(store: Store, user: string, chat: string, turns: readonly string[]): Map<string, SceneRef | null> {
  const out = new Map<string, SceneRef | null>();
  const u = store.user(user);
  if (u.chat(chat) === null) return out;
  const left = new Set(turns);
  for (const deepest of [...turns].reverse()) {
    if (!left.has(deepest)) continue;
    const at = storyAt(u, chat, deepest);
    for (const turn of at.turns) {
      if (!left.delete(turn)) continue;
      const scene = new StoryRecord(at, storySliceOf(u.stateAt(turn).state)).current("scene");
      out.set(turn, scene === null || (scene.closedBy !== null && scene.closedBy !== turn) ? null : sceneRef(scene));
    }
    left.delete(deepest);
  }
  return out;
}

/** The scenes the story record holds closed at a reading of the chat (at `turn`, with what it has recorded; at the head for null), by id. */
export function closedScenesAt(store: Store, user: string, chat: string, turn: string | null): Map<string, SceneRef> {
  const u = store.user(user);
  if (u.chat(chat) === null) return new Map();
  const record = StoryRecord.read(store, user, storyAt(u, chat, turn));
  return new Map(record.of("scene").flatMap((scene) => (scene.closedBy === null ? [] : [[scene.id, sceneRef(scene)] as const])));
}

/**
 * The scene each of `turns` lies in as the story record stands at one reading of the chat (at `at`, with what it has recorded; at the
 * head for null), by its id: the scene whose messages hold the turn's reply, the one that starts later where two do; for a turn whose
 * reply is not saved yet, the scene the record holds open. Null for a turn in none. It reads the record once, where `scenesOf` reads each
 * turn's own state: what a long list is laid out and read by (a character's outline of what it perceived, `self_read` by scene), never
 * what a rule counts by. It gives no title: what it is read for is the character's own, and a scene's title is the story record's words
 * (the Author's account of what happened in it), which the character's reads never hold.
 */
export function scenesAcross(store: Store, user: string, chat: string, at: string | null, turns: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const u = store.user(user);
  if (u.chat(chat) === null) return out;
  const record = StoryRecord.read(store, user, storyAt(u, chat, at));
  const spans = [...record.spans("scene")].flatMap(([id, span]) => {
    const scene = record.items.get(id);
    return scene === undefined || span.from === null ? [] : [{ scene, from: span.from, to: span.to ?? span.from }];
  });
  const open = record.current("scene");
  for (const turn of turns) {
    const reply = record.at.replyOf(turn);
    const scene = reply === null ? (open !== null && open.closedBy === null ? open : null) : (spans.filter((s) => s.from <= reply && reply <= s.to).sort((a, b) => b.from - a.from)[0]?.scene ?? null);
    out.set(turn, scene === null ? null : scene.id);
  }
  return out;
}

/** What a stage puts in mind for what comes to a character's mind: its place and the things there, by name. */
export function stageCues(stage: Stage): string[] {
  return [...(stage.place === null ? [] : [stage.place]), ...stage.things];
}

const wordsOf = (text: string): string => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/**
 * The people, places and things of the world that `texts` name (R-144), by their ids and by their words as whole words: the moment an
 * agent was handed, its task and the message that continues it. Code matches names and ids; it never reads what the text means.
 */
export function namedIn(store: Store, user: string, chat: string, turn: string | null, texts: readonly string[]): string[] {
  const u = store.user(user);
  if (u.chat(chat) === null) return [];
  const world = (turn === null ? u.headState(chat) : u.stateAt(turn)).state.world;
  const doc = store.env.worlds(world.revision);
  const said = wordsOf(texts.join(" "));
  if (doc === undefined || said.trim() === "") return [];
  const names = (id: string, name: string): boolean => [name, id].some((w) => wordsOf(w).trim() !== "" && said.includes(wordsOf(w)));
  const out = new Set<string>();
  for (const [id, e] of Object.entries(world.entities)) if (!isGone(world, id) && names(id, e.name)) out.add(e.name);
  for (const [id, p] of Object.entries(doc.places)) if (names(id, p.name)) out.add(p.name);
  return [...out];
}
