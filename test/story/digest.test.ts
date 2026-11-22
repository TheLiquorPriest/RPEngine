// The part of the scene an agent is handed and what stands for the rest (plan 3.2 §6.6): the stretch `scene-window` begins at the
// first message the prompt's window kept where that lies inside the open scene; the scene digest gives the scene before by the
// summary the record holds, and this scene's beats for the messages before that point, and writes no summary of its own. Every
// name is invented.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFolderHost } from "rp-harness/hosts/folder";
import { loadGuidance, type TemplatePart } from "../../src/app/guidance";
import { sceneDigest } from "../../src/story/index";
import { namedStretches, SCENE_WINDOW } from "../../src/turn/stage";
import { CHAT, openTable, type Table, USER } from "./rig";

const PROMPTS = resolve(import.meta.dir, "../../guidance/.prompts");

let dir = "";
let layout: TemplatePart;

beforeAll(async () => {
  // The shipped layout, loaded the way the agents' guidance is: as the shipped level of a folder host.
  dir = mkdtempSync(join(tmpdir(), "rpe-scene-digest-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  copyFileSync(join(PROMPTS, "scene-digest.md"), join(dir, "files", "defaults", ".prompts", "scene-digest.md"));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const part = await loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" }).part("scene-digest");
  if (part?.format !== "template") throw new Error("The shipped scene-digest part did not load as a template.");
  layout = part;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A closed scene with a summary, then an open one of three exchanges with a beat in each. */
async function played(summary = true): Promise<{ t: Table; ford: string; mill: string }> {
  const t = await openTable();
  await t.play([
    { part: "scene", item: null, value: { title: "The ford" } },
    { part: "beat", item: null, value: { text: "Corvin wades in." } },
  ]);
  const ford = t.record().of("scene")[0]?.id ?? "";
  await t.play([
    { part: "scene", item: ford, value: summary ? { close: true, summary: "Corvin is left at the ford." } : { close: true } },
    { part: "scene", item: null, value: { title: "The mill" } },
    { part: "beat", item: null, value: { text: "Mira finds the door barred." } },
  ]);
  await t.play([{ part: "beat", item: null, value: { text: "Tobin swears he has no key." } }]);
  await t.play([{ part: "beat", item: null, value: { text: "The wheel turns once, by itself." } }]);
  const mill = t.record().of("scene")[1]?.id ?? "";
  return { t, ford, mill };
}

describe("the scene's window", () => {
  test("begins at the first message the prompt kept where that lies inside the scene, and is the whole scene where the window cut nothing or cut before it", async () => {
    const { t } = await played();
    const whole = namedStretches(t.store, USER, CHAT, null);
    const scene = whole.scene;
    expect(scene).toBeDefined();
    expect(scene?.to).toBe(t.shown.length);
    expect(whole[SCENE_WINDOW]).toEqual(scene!);
    // The window kept from the sixth message on: the part of the scene handed over begins there.
    expect(namedStretches(t.store, USER, CHAT, null, "m6")[SCENE_WINDOW]).toEqual({ from: 6, to: t.shown.length });
    // It cut inside the scene before this one: the whole of this scene is handed over.
    expect(namedStretches(t.store, USER, CHAT, null, "m1")[SCENE_WINDOW]).toEqual(scene!);
    // A message the chat no longer holds places nothing.
    expect(namedStretches(t.store, USER, CHAT, null, "gone")[SCENE_WINDOW]).toEqual(scene!);
  });
});

describe("the scene digest", () => {
  test("gives the scene before by the summary the record holds, and this scene's beats for the messages before the ones handed over", async () => {
    const { t, ford } = await played();
    const digest = sceneDigest({ store: t.store, user: USER, chat: CHAT, turn: null, layout, shownFrom: 6 });
    expect(digest.fields.before).toMatchObject({ id: ford, title: "The ford", summary: "Corvin is left at the ford." });
    // The beats of this scene that lie before message 6, oldest first; the one at or after it is in the messages handed over.
    expect(digest.fields.earlier?.items.map((beat) => beat.text)).toEqual(["Mira finds the door barred.", "Tobin swears he has no key."]);
    expect(digest.fields.earlier?.to).toBe(5);
    expect(digest.text).toContain(`### The scene before [${ford}]: The ford`);
    expect(digest.text).toContain("- Corvin is left at the ford.");
    expect(digest.text).toContain("### Earlier in this scene, messages");
    expect(digest.text).toContain("Tobin swears he has no key.");
    expect(digest.text).not.toContain("The wheel turns once, by itself.");
    expect(digest.text).not.toContain("Corvin wades in.");
  });

  test("handed the whole scene, it lists no beat; with no summary recorded it says so and writes none", async () => {
    const { t, ford } = await played(false);
    const whole = sceneDigest({ store: t.store, user: USER, chat: CHAT, turn: null, layout, shownFrom: null });
    expect(whole.fields.earlier).toBeUndefined();
    expect(whole.fields.before).toMatchObject({ id: ford, title: "The ford" });
    expect(whole.fields.before).not.toHaveProperty("summary");
    expect(whole.text).toContain("No summary of it is recorded.");
    expect(whole.text).not.toContain("Earlier in this scene");
  });

  test("with no scene before and nothing of this one left out, it holds nothing", async () => {
    const t = await openTable();
    await t.play([{ part: "scene", item: null, value: { title: "The ford" } }]);
    const digest = sceneDigest({ store: t.store, user: USER, chat: CHAT, turn: null, layout, shownFrom: null });
    expect(digest).toEqual({ text: "", fields: {} });
    expect(layout.render({ none: true }).text.trim()).toBe("No scene stands before this one in the story record, and nothing of this scene lies before the messages you were handed.");
  });
});
