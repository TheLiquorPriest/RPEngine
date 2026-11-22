// The two profiles of plan 3.2 §7.4 in a played turn: the Author hands a part of its work to an `author-assistant` with `task`, which
// is given the lore map of the Author's own briefing and the story brief, holds the tools that read and record and none that writes
// to the player, and answers the Author; and a reading tool of RPE's asked a question starts the `reader`, which holds no tool, is
// handed the tool's answer whole and answers once, so that the Author reads the reader's answer and none of the record. Played
// through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject, TraceEvent, TraceRecord } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import { CHAT, CONNECTION, openTurnBed, PRESET, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** One answer that makes one tool call, after the intent record when one is given. */
function calling(call: string, args: JsonObject, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] };
}

/** A record of an agent's start, as the turn's trace keeps it. */
type Started = TraceRecord & { event: Extract<TraceEvent, { kind: "agent_started" }> };

/** Plays one turn to its end and gives each agent's start its trace kept, in order. */
async function play(b: TurnBed, said: string): Promise<Started[]> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = await settledTurn(b, out.generationId!);
  const run = b.turns.runs.byGeneration(USER, out.generationId!)!;
  const kept = await b.turns.trace.kept({ user: USER, chat: CHAT, session: run.session, turn: turn.id });
  return kept.filter((record): record is Started => record.event.kind === "agent_started");
}

/** Each call answered from the list of the agent that makes it, told apart by `whose`. */
function routed(lists: Record<string, Answer[]>, whose: (tools: readonly string[], sent: string) => string): Answer[] {
  const route: Answer = (request) => {
    const next = lists[whose(request.tools.map((t) => t.name), JSON.stringify(request.messages))]?.shift();
    if (next === undefined) throw new Error("the script has no answer left for this call");
    return typeof next === "function" ? next(request) : next;
  };
  return Array.from({ length: Object.values(lists).reduce((sum, list) => sum + list.length, 0) }, () => route);
}

test("the Author hands a part of its work to an author-assistant: it holds the tools that read and record and none that writes to the player, is given the story brief, and answers the Author", async () => {
  const PART = "BRIEF-PART Find every thread the late boat touches.";
  const lists = {
    author: [calling("task", { agent: "author-assistant", pieces: [{ brief: PART, name: "threads" }] }, "The boat is late; I look for what hangs on it."), { pieces: [{ text: "<reply>The boat is late, and nobody on the quay will say why.</reply>" }] }] as Answer[],
    assistant: [{ pieces: [{ text: "ASSISTANT-FOUND No thread names the boat yet." }] }] as Answer[],
  };
  const b = await openTurnBed({ off: ["rules/unsourced"], answers: routed(lists, (tools) => (tools.includes("write_reply") ? "author" : "assistant")) });
  beds.push(b);
  const starts = await play(b, "I ask whether the boat came.");
  expect([lists.author.length, lists.assistant.length]).toEqual([0, 0]);

  const assistant = b.model.requests.find((r) => !r.tools.some((t) => t.name === "write_reply"));
  expect(assistant).toBeDefined();
  const held = assistant!.tools.map((t) => t.name);
  for (const tool of ["write_reply", "reply_release", "delegate", "agent_message", "job_start"]) expect({ tool, held: held.includes(tool) }).toEqual({ tool, held: false });
  for (const tool of ["story_query", "world_query", "cast_query", "lore_read", "chat_read", "story_record", "world_apply", "ask_author", "task"]) expect({ tool, held: held.includes(tool) }).toEqual({ tool, held: true });
  const sent = JSON.stringify(assistant!.messages);
  expect(sent).toContain(PART);
  // What its definition names it is handed: the story brief, by RPE's own view of it.
  const started = starts.find((record) => record.agent?.definition === "author-assistant");
  expect(started?.event.operation).toBe("task");
  expect(started?.event.sent?.map((item) => item.name)).toContain("story:brief");
  // Its answer came back to the Author.
  expect(b.model.requests.some((r) => r.tools.some((t) => t.name === "write_reply") && JSON.stringify(r.messages).includes("ASSISTANT-FOUND"))).toBe(true);
});

test("story_query asked a question starts the reader, which holds no tool and is handed the answer whole; the Author reads what the reader says and none of the record", async () => {
  const lists = {
    author: [calling("story_query", { part: "player", question: "QUESTION-ONE What does the player enjoy?" }, "I check what the player enjoys."), { pieces: [{ text: "<reply>The quay is quiet.</reply>" }] }] as Answer[],
    reader: [{ pieces: [{ text: "READER-SAYS The record holds nothing of it yet." }] }] as Answer[],
  };
  const b = await openTurnBed({ off: ["rules/unsourced"], answers: routed(lists, (tools) => (tools.length === 0 ? "reader" : "author")) });
  beds.push(b);
  const starts = await play(b, "I look along the quay.");
  expect([lists.author.length, lists.reader.length]).toEqual([0, 0]);

  const reader = b.model.requests.find((r) => r.tools.length === 0);
  expect(reader).toBeDefined();
  const handed = JSON.stringify(reader!.messages);
  expect(handed).toContain("QUESTION-ONE What does the player enjoy?");
  // The source is the tool's own answer, under the call it is the answer of.
  expect(handed).toContain('### story_query {\\"part\\":\\"player\\"}');
  const started = starts.filter((record) => record.event.operation === "reader");
  expect(started.map((record) => record.agent?.definition)).toEqual(["reader"]);
  // The Author's next request holds the reader's answer as the call's.
  const after = b.model.requests.filter((r) => r.tools.some((t) => t.name === "write_reply")).at(-1)!;
  expect(JSON.stringify(after.messages)).toContain("reader-1 read what you asked about and answers:\\n\\nREADER-SAYS The record holds nothing of it yet.");
});
