// Purposes on RPE's side (plan 3.2 §6.3): the route of what each definition is given lists each purpose's names beside what every start
// is given, each of RPE's views with its size at the chat's newest turn, read as a preview so nothing is kept of it; a start that names
// a purpose is kept with it and the turn's record says so, while a preview is kept as no start; a job he starts takes a purpose as its
// definition names them. Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "rp-harness/contract";
import type { Answer } from "rp-harness/testing/rig";
import type { GivenReply, TurnReply } from "../../src/shared/api";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A definition of the user's own with two purposes: one a part of what every start is given, one that names a view nothing provides. */
const SCRIBE = [
  "---",
  "name: scribe",
  "description: Fixture scribe of the harbour's ledger.",
  "model: default",
  "tools: []",
  "reads: []",
  "given: [story:brief, world:scene(full), file:notes/tide.md]",
  "purposes:",
  "  tally: [story:brief]",
  "  check: [world:scene(full), ledger:none]",
  "---",
  "Fixture scribe: you count what you are asked to count.",
  "",
].join("\n");

/** The bed with the scribe among the user's own definitions. */
async function bedWithScribe(answers: Answer[]): Promise<TurnBed> {
  const b = await openTurnBed({ off: ["rules/unsourced"], answers });
  beds.push(b);
  mkdirSync(join(b.app.paths.files, ".agents"), { recursive: true });
  writeFileSync(join(b.app.paths.files, ".agents", "scribe.md"), SCRIBE);
  return b;
}

async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

/** One answer that makes one tool call, after the intent record when one is given. */
function calling(call: string, args: JsonObject, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] };
}

test("the given route lists each purpose's names beside what every start is given, each view of RPE's with its size at the newest turn, and names what nothing provides", async () => {
  const b = await bedWithScribe([replying("The tide turns.")]);
  await play(b, "I watch the harbour.");
  const reply = await b.page<GivenReply>("GET", `/api/v1/chats/${CHAT}/given`);
  expect(reply.status).toBe(200);
  const scribe = reply.body.definitions.find((d) => d.name === "scribe");
  expect(scribe?.given.map((g) => [g.name, g.by, g.found, g.tokens === null ? null : "sized"])).toEqual([
    ["story:brief", "rpe", true, "sized"],
    ["world:scene(full)", "rpe", true, "sized"],
    // RPH finds its own kinds at the run: never read or measured here.
    ["file:notes/tide.md", "rph", null, null],
  ]);
  expect(scribe?.purposes.map((p) => [p.name, p.given.map((g) => [g.name, g.found, g.tokens === null ? null : "sized"])])).toEqual([
    ["tally", [["story:brief", true, "sized"]]],
    ["check", [["world:scene(full)", true, "sized"], ["ledger:none", false, null]]],
  ]);
  // A name stands at one size wherever it is listed.
  const sizeIn = (list: GivenReply["definitions"][number]["given"] | undefined, name: string) => list?.find((g) => g.name === name)?.tokens;
  expect(sizeIn(scribe?.purposes[0]?.given, "story:brief")).toBe(sizeIn(scribe?.given, "story:brief") ?? -1);
  expect(scribe?.missing).toEqual(["ledger:none"]);
  // A definition that names no purposes lists none.
  expect(reply.body.definitions.find((d) => d.name === "keeper")?.purposes).toEqual([]);
});

test("a start that names a purpose is kept with it, a preview is kept as no start, and the turn's record says what each agent was given for", async () => {
  const brief = "Count the boats at anchor.";
  const b = await bedWithScribe([
    calling("delegate", { agent: "scribe", brief, for: "tally", preview: true }, "I count the boats."),
    calling("delegate", { agent: "scribe", brief, for: "tally" }),
    { pieces: [{ text: "Seven." }] },
    { pieces: [{ text: "<reply>Seven boats ride at anchor.</reply>" }] },
  ]);
  const turn = await play(b, "How many boats?");
  const shown = await b.page<TurnReply>("GET", `/api/v1/chats/${CHAT}/turns/${turn}`);
  expect(shown.status).toBe(200);
  const scribes = shown.body.told.attachments.filter((a) => a.agent.definition === "scribe");
  // One start, not two: the preview started nobody.
  expect(scribes.map((a) => a.purpose)).toEqual(["tally"]);
  expect(JSON.stringify(scribes[0]?.refs)).toContain("story:brief");
  expect(JSON.stringify(scribes[0]?.refs)).not.toContain("world:scene(full)");
  // The Author's own start named none.
  expect(shown.body.told.attachments.filter((a) => a.agent.definition === "author").every((a) => a.purpose === undefined)).toBe(true);
  // The preview answered what the start would hand over, and the scribe was then handed its list for the purpose alone.
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent.some((s) => s.includes("Nobody was started"))).toBe(true);
});

test("a job he starts takes a purpose its definition names, and keeps it with the job", async () => {
  const b = await bedWithScribe([{ pieces: [{ text: "Seven." }] }]);
  const started = await b.page<{ job: { id: string; agent: string; for?: string; leave?: string[] } }>("POST", `/api/v1/chats/${CHAT}/jobs`, { definition: "scribe", brief: "Count the boats at anchor.", for: "tally" });
  expect(started.status).toBe(200);
  expect(started.body.job).toMatchObject({ agent: "scribe", for: "tally" });
  await b.until("the job to end", async () => (await b.turns.harness.jobs.list({ user: USER, chat: CHAT })).jobs.find((j) => j.id === started.body.job.id && j.ended !== undefined));
  const kept = await b.turns.harness.jobs.get(USER, started.body.job.id);
  expect(kept?.for).toBe("tally");
});
