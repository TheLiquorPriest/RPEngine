// What waits for a character's own agent (plan §7.3, §7.4): the perceptions it has not taken in (`takenIn`, `memory.ts`), each with the
// turn it is of and the turn it came into the record in, and when it last dreamt (the row each dream keeps, `memories.ts`). Read from
// the record and nothing else, and counted only for turns RPE played: a turn a migration carried owes nothing of the kind (§15.2), as the
// perception counts have it. A perception waits from when it was written, not from the moment it is of: one written late of an earlier
// turn has waited no longer than since it was written. And none waits that a job of the character's own agent already has in hand: a
// job is given every perception the character holds untaken when it starts, and what it writes counts once it has ended. The jobs are
// the host's to say (`JobsOf`); which of them have a character's perceptions in hand is worked out here once (`inHandOf`), so that the
// cast's facts, the Cast page and the press that starts a take-in count it alike. Code decides nothing about what should be done with it.

import type { Database } from "bun:sqlite";
import type { JobState } from "rp-harness/contract";
import { type CastAt } from "./path";
import { untakenPerceptions } from "./memory";
import { perceivedTurn } from "./perceive";
import { type CastItem, type CastRecord, type Character, dreamItemId, findCharacter } from "./record";

/**
 * A perception its own agent has not taken in: the turn it is of (`of`), and the turn it came into the record in (`turn`, the turn it
 * is of where the one that wrote it is not on the reading's path) with that turn's place on the path (`index`; after every turn of it,
 * for a turn not on it), from which it waits.
 */
export interface Untaken {
  item: CastItem;
  of: string;
  turn: string;
  index: number;
}

/**
 * A job of a character's own agent that has what it holds untaken in hand at a reading: going on or waiting to, or ended with what it
 * wrote not yet in the reading. When it was started (milliseconds), and the turn that started it (null: none, his own job).
 */
export interface InHand {
  started: number;
  turn: string | null;
}

/** A job of the chat, as what waits reads it: its id, whom its agent plays (by name; null: no one), its state, when it started and ended, and the turn that started it (null: none). */
export interface JobRead {
  id: string;
  plays: string | null;
  state: JobState;
  started: number;
  ended: number | null;
  turn: string | null;
}

/** The chat's jobs that may have a character's perceptions in hand: those going on or waiting to, and those ended since `since` (milliseconds). The host's to say. */
export type JobsOf = (scope: { user: string; chat: string }, since: number) => Promise<readonly JobRead[]>;

/** The states of a job not yet ended: its agent is at work, or will be. */
const GOING: Readonly<Partial<Record<JobState, true>>> = { queued: true, held: true, running: true, asking: true };

/** Whether a job has not ended: its agent is at work, or will be. */
export function isGoing(job: Pick<JobRead, "state">): boolean {
  return GOING[job.state] === true;
}

/** The character a job's agent plays, by the name its start gave, among the characters of `chats` (null: none of them); each name is looked up once. */
export function playedByIn(db: Database, user: string, chats: readonly string[]): (plays: string) => string | null {
  const found = new Map<string, string | null>();
  return (plays) => {
    if (!found.has(plays)) found.set(plays, findCharacter(db, user, chats, plays)?.id ?? null);
    return found.get(plays) ?? null;
  };
}

/**
 * The jobs of each character's own agent that have its perceptions in hand at the reading `at`: going on or waiting to, or done once the
 * turn read began (`began`, milliseconds; at the chat's head, none: what a job writes counts from the turn after it ended), each started
 * by no turn or by one on the reading's path. `playedBy` is the character a job's agent plays.
 */
export function inHandOf(jobs: readonly JobRead[], at: CastAt, began: number, playedBy: (plays: string) => string | null): (character: Character) => InHand[] {
  return (character) =>
    jobs.flatMap((j) =>
      j.plays !== null && playedBy(j.plays) === character.id && (isGoing(j) || (j.state === "done" && j.ended !== null && j.ended >= began)) && (j.turn === null || at.order.has(j.turn))
        ? [{ started: j.started, turn: j.turn }]
        : [],
    );
}

/** What waits for one character's own agent at a reading. */
export interface Waiting {
  character: Character;
  /** Its perceptions its own agent has not taken in and no job of it has in hand, of turns RPE played, the longest waiting first. */
  untaken: Untaken[];
  /** Its last dream: the turn it was had in and its story time (null in a chat that keeps no clock); null when it never dreamt. */
  dreamt: { turn: string; at: number | null } | null;
}

/**
 * What waits for each of `characters` at the record's reading; `played` holds the turns of the reading's path RPE played, and `inHand`
 * gives the jobs of a character's own agent that have its perceptions in hand there (`inHandOf`).
 */
export function waitingOf(record: CastRecord, characters: readonly Character[], played: ReadonlySet<string>, inHand: (character: Character) => readonly InHand[]): Waiting[] {
  const { at } = record;
  const place = (turn: string): number => at.order.get(turn) ?? at.turns.length;
  return characters.map((character) => {
    const jobs = inHand(character);
    // A job has a perception in hand that was written before it started; one whose writer's moment is not kept, by its turn.
    const held = (u: Untaken): boolean => {
      const when = u.item.rows[0]?.when ?? null;
      return jobs.some((j) => (when !== null ? when <= j.started : j.turn !== null && u.index <= place(j.turn)));
    };
    const untaken = untakenPerceptions(record, character.id)
      .map((item): Untaken => {
        const of = perceivedTurn(item);
        const turn = at.order.has(item.opened) ? item.opened : of;
        return { item, of, turn, index: Math.max(place(of), place(turn)) };
      })
      .filter((u) => (!at.order.has(u.of) || played.has(u.of)) && !held(u))
      .sort((a, b) => a.index - b.index);
    const dream = record.items.get(dreamItemId(character.id));
    const last = dream === undefined || dream.dropped ? undefined : dream.rows.at(-1);
    return { character, untaken, dreamt: last === undefined ? null : { turn: last.turn, at: last.at } };
  });
}

/** The turns RPE played on the reading's path after the one at `index`, the turn read included. */
export function turnsSince(at: CastAt, played: ReadonlySet<string>, index: number): number {
  return at.turns.filter((t, i) => i > index && played.has(t)).length;
}
