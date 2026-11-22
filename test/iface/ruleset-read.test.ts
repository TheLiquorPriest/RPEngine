// `ruleset_read` (plan 3.2 §6.6): one part of the world's ruleset whole, or one entry of a part by its id or name, the same data
// `world_query` gives at `ruleset`; and the ruleset's parts as its index lists them, each with how many entries it holds and its
// size. Every name here is made up.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { rulesetEntry, rulesetParts } from "../../src/iface/index";
import { dataOf, rig, texts, wordsFromFiles } from "./rig";

/** A counter as the turn gives one: the chat's characters to a token. */
const tokens = (text: string): number => Math.ceil(text.length / 4);

describe("ruleset_read", () => {
  test("a part comes whole, as world_query gives it at ruleset; an entry comes alone, by its id or its name", async () => {
    const t = await rig({ tokens });
    const all = dataOf(await t.call("world_query", { at: "ruleset" })).ruleset as JsonObject;
    const part = await t.call("ruleset_read", { part: "bestiary" });
    expect(part.error).toBeUndefined();
    expect(dataOf(part)).toEqual({ ruleset: { bestiary: all.bestiary ?? null } });

    const guard = (all.bestiary as JsonObject[]).find((row) => row.id === "town_guard");
    expect(guard).toBeDefined();
    expect(dataOf(await t.call("ruleset_read", { part: "bestiary", id: "town_guard" }))).toEqual({ ruleset: { bestiary: guard ?? null } });
    expect(dataOf(await t.call("ruleset_read", { part: "Bestiary", id: " Town Guard " }))).toEqual({ ruleset: { bestiary: guard ?? null } });
    // A part that is a list of words gives the word asked for.
    expect(dataOf(await t.call("ruleset_read", { part: "actions", id: "attempt" }))).toEqual({ ruleset: { actions: "attempt" } });
  });

  test("a part the ruleset does not have is answered with the parts it has, and an entry it does not hold with how many it holds", async () => {
    const t = await rig({ tokens });
    const unknown = await t.call("ruleset_read", { part: "spells" });
    expect(unknown.error).toBe(true);
    expect(texts(unknown)[0]).toBe('part cannot be read: you sent "spells". It is one of: checks, actions, bestiary.');
    const missing = await t.call("ruleset_read", { part: "bestiary", id: "dragon" });
    expect(missing.error).toBe(true);
    wordsFromFiles(missing);
    expect(texts(missing)[0]).toBe('The ruleset\'s bestiary has nothing called "dragon" among its 2 entries. ruleset_read with the part alone reads all of it.');
  });
});

describe("the ruleset's parts and entries", () => {
  const ruleset: JsonObject = { minLevels: { combat: 2, money: 1 }, checks: ["climb", "swim"], bestiary: [{ id: "wolf", name: "Grey wolf" }], note: "House rules apply." };

  test("each part is listed in the ruleset's order with how many entries it holds, and with a counter its size", () => {
    expect(rulesetParts(ruleset)).toEqual([{ part: "minLevels", entries: 2 }, { part: "checks", entries: 2 }, { part: "bestiary", entries: 1 }, { part: "note" }]);
    expect(rulesetParts(ruleset, tokens).map((p) => p.tokens)).toEqual([tokens(JSON.stringify(ruleset.minLevels)), tokens(JSON.stringify(ruleset.checks)), tokens(JSON.stringify(ruleset.bestiary)), tokens(JSON.stringify(ruleset.note))]);
  });

  test("an entry is found by a key, by a record's id or name, or as the word itself, case ignored; a part of one value holds none", () => {
    expect(rulesetEntry(ruleset.minLevels, "Combat")).toBe(2);
    expect(rulesetEntry(ruleset.checks, "swim")).toBe("swim");
    expect(rulesetEntry(ruleset.bestiary, "grey wolf")).toEqual({ id: "wolf", name: "Grey wolf" });
    expect(rulesetEntry(ruleset.bestiary, "bear")).toBeUndefined();
    expect(rulesetEntry(ruleset.note, "house")).toBeUndefined();
  });
});
