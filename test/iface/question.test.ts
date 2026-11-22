// A reading tool of RPE's asked a `question` (plan 3.2 §7.4): it answers as the call asks, whole where the call names no `how`,
// hands that answer to a reader through the door RPH gives the call, and gives back what the reader says, so its own answer reaches
// nobody's window. An answer that says the call could not be read stands as it is; a caller that can ask no reader is told so; and
// the tool's own code never sees the question. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject, ReaderSource, ToolCtx, ToolResult } from "rp-harness/contract";
import { CHAT, rig, type Rig, texts, USER } from "./rig";

/** What a reader was handed, each time one was asked. */
interface Asked {
  question: string;
  sources: readonly ReaderSource[];
}

/** A call of one of the rig's tools as RPH makes it for an agent that can ask a reader (`reader` given) or cannot. */
async function call(t: Rig, name: string, args: JsonObject, reader?: (asked: Asked) => ToolResult): Promise<ToolResult> {
  const tool = t.tools.get(name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  const ctx: ToolCtx = {
    scope: { user: USER, chat: CHAT, session: "s-1", turn: t.turn.id },
    agent: { id: "author-1", definition: "author" },
    run: "run-1",
    callId: "call-1",
    signal: new AbortController().signal,
    onUpdate: () => undefined,
    ...(reader !== undefined ? { reader: async (question: string, sources: readonly ReaderSource[]) => reader({ question, sources }) } : {}),
  };
  return tool.run(args, ctx);
}

const SAID: ToolResult = { content: [{ type: "text", text: "reader-1 read what you asked about and answers:\n\nThe mill stands at the north end." }] };

describe("world_query asked a question", () => {
  test("hands a reader everything beneath the point, under the call it is the answer of, and gives back the reader's answer and none of its own", async () => {
    const t = await rig({});
    const whole = texts(await call(t, "world_query", { at: "thornbury", depth: "full" })).join("\n");
    const asked: Asked[] = [];
    const answer = await call(t, "world_query", { at: "thornbury", question: "Where does the mill stand?" }, (one) => {
      asked.push(one);
      return SAID;
    });
    expect(answer).toEqual(SAID);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.question).toBe("Where does the mill stand?");
    // The source is the answer the call would have given whole, named by the call without its question.
    expect(asked[0]?.sources).toEqual([{ name: 'world_query {"at":"thornbury"}', text: whole }]);
  });

  test("reads as much as the call itself names: a depth or a how said holds", async () => {
    const t = await rig({});
    const top = texts(await call(t, "world_query", { at: "thornbury", depth: 0 })).join("\n");
    const asked: Asked[] = [];
    const keep = (one: Asked): ToolResult => {
      asked.push(one);
      return SAID;
    };
    await call(t, "world_query", { at: "thornbury", depth: 0, question: "What is here?" }, keep);
    await call(t, "world_query", { at: "thornbury", how: "gist", question: "What is here?" }, keep);
    expect(asked.map((one) => one.sources[0]?.text)).toEqual([top, top]);
  });

  test("an answer that says the call could not be read stands as it is, and no reader is asked", async () => {
    const t = await rig({});
    const asked: Asked[] = [];
    const refused = await call(t, "world_query", { at: "no-such-place-anywhere", question: "What is here?" }, (one) => {
      asked.push(one);
      return SAID;
    });
    expect(refused.error).toBe(true);
    expect(asked).toEqual([]);
    expect(refused).toEqual(await call(t, "world_query", { at: "no-such-place-anywhere" }));
  });

  test("a caller that can ask no reader is told so, and is given none of the answer", async () => {
    const t = await rig({});
    const told = await call(t, "world_query", { at: "thornbury", question: "Where does the mill stand?" });
    expect(told.error).toBe(true);
    expect(texts(told)).toEqual(["world_query handed your question to nobody: a question is answered by a reader, and you are given none (a reader has none of its own). Call it again without the question and read the answer yourself."]);
  });

  test("a question with no words in it is no question: the call answers as it would without one", async () => {
    const t = await rig({});
    const plain = await call(t, "world_query", { at: "thornbury" });
    expect(await call(t, "world_query", { at: "thornbury", question: "  " }, () => SAID)).toEqual(plain);
  });
});

test("the tools that take a question say so in their schemas, each with its file's words, and no other tool of the engine's does", async () => {
  const t = await rig({});
  const takes = [...t.tools.values()].filter((tool) => Object.hasOwn((tool.parameters.properties ?? {}) as JsonObject, "question")).map((tool) => tool.name);
  expect(takes).toEqual(["world_query"]);
  const described = ((t.tools.get("world_query")?.parameters.properties as JsonObject | undefined)?.question as JsonObject | undefined)?.description;
  expect(typeof described === "string" && described.startsWith("A question about what this call reads.")).toBe(true);
});
