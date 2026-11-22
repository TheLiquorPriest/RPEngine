// The bestiary (plan §6.5, the ruleset-and-sheets skill): ordinary foes and strangers the world's
// rules know, for the GM to read and to draw someone from who comes into view with no sheet. It is
// a data table of the world's rules, as its other tables are (`DataTable`, in the world document's
// `tables`), which the combat pack registers (`packs/combat/core/bestiary.ts`), empty. Code reads it and
// copies a row's values onto someone made from it; which row fits a stranger is the GM's to say.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { offeredActions } from "../engine/offered";
import type { Registry } from "../engine/registry-impl";
import { BESTIARY_TABLE } from "../packs/combat/core/bestiary";
import { D20_ACTIONS, type D20Def, type D20TableRole, saveLabel } from "../shared/d20";
import { say } from "../shared/lines";
import type { TableRow } from "../shared/tables";
import type { RulesetDef, WorldDoc } from "../shared/world";

export { BESTIARY_COLUMNS, BESTIARY_SCHEMA, BESTIARY_TABLE } from "../packs/combat/core/bestiary";

/** One row of the bestiary: someone ordinary of a kind, with the sheet values the world's rules give them. */
export interface BestiaryRow {
  id: string;
  name: string;
  kind: string;
  tier?: string;
  fields: JsonObject;
  carries: string[];
  description?: string;
}

function rowOf(id: string, row: TableRow): BestiaryRow | null {
  const name = typeof row.name === "string" && row.name.trim() !== "" ? row.name.trim() : null;
  const kind = typeof row.kind === "string" && row.kind.trim() !== "" ? row.kind.trim() : null;
  if (name === null || kind === null) return null;
  const fields = typeof row.fields === "object" && row.fields !== null && !Array.isArray(row.fields) ? (row.fields as JsonObject) : {};
  const carries = Array.isArray(row.carries) ? row.carries.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  return { id, name, kind, fields, carries, ...(typeof row.tier === "string" && row.tier !== "" ? { tier: row.tier } : {}), ...(typeof row.description === "string" && row.description !== "" ? { description: row.description } : {}) };
}

/** The world's bestiary, in its table's order; empty when the world has none. A row with no name or kind is passed over. */
export function bestiaryOf(world: Pick<WorldDoc, "tables">): BestiaryRow[] {
  const table = world.tables[BESTIARY_TABLE];
  if (table === undefined) return [];
  return Object.entries(table.rows).flatMap(([id, row]) => rowOf(id, row) ?? []);
}

/** A row by its id, or by its name in any case. */
export function bestiaryRow(world: Pick<WorldDoc, "tables">, said: string): BestiaryRow | undefined {
  const rows = bestiaryOf(world);
  const lower = said.trim().toLowerCase();
  return rows.find((r) => r.id === said.trim()) ?? rows.find((r) => r.id.toLowerCase() === lower || r.name.toLowerCase() === lower);
}

/**
 * The tabletop rules as the GM reads them (RULESET-DESIGN §5.4): which ruleset, its abilities, skills, saves, classes, conditions and
 * usual difficulties, the totals its sheets give, and the actions that work its numbers out, with a line saying how they are used.
 */
function d20Summary(world: Pick<WorldDoc, "ruleset" | "tables">, d20: D20Def): JsonObject {
  const rows = (role: D20TableRole): [string, TableRow][] => {
    const id = d20.tables[role];
    const t = id === undefined ? undefined : world.tables[id];
    return t ? Object.entries(t.rows) : [];
  };
  const label = (id: string, row: TableRow): string => (typeof row.label === "string" && row.label !== "" ? row.label : id);
  return {
    ...(typeof world.ruleset?.profile === "string" ? { ruleset: world.ruleset.profile } : {}),
    abilities: d20.abilities,
    saves: Object.keys(d20.totals)
      .filter((k) => k.startsWith("save."))
      .map((k) => `${saveLabel(d20, k.slice(5))} [${k.slice(5)}]`),
    totals: Object.keys(d20.totals),
    skills: rows("skills").map(([id, row]) => say("d20_ruleset_skill", { skill: label(id, row), id, ability: String(row.ability ?? ""), ...(row.trained === true ? { trained: true } : {}), ...(row.armor === true ? { armor: true } : {}) })),
    classes: rows("classes").map(([id, row]) => `${label(id, row)} [${id}]`),
    conditions: rows("conditions").map(([id, row]) => `${label(id, row)} [${id}]`),
    difficulties: rows("difficulties").map(([id, row]) => `${label(id, row)} ${String(row.dc ?? "")}`),
    actions: [...D20_ACTIONS],
    use: say("d20_ruleset_use"),
  };
}

/** The world's ruleset part as data, its bestiary with it: what the GM reads to rule by. `actions`: the ids of the actions listed, the world's own when not given. */
export function rulesetData(world: Pick<WorldDoc, "ruleset" | "tables" | "checks" | "actions">, actions: readonly string[] = Object.keys(world.actions)): JsonObject {
  const ruleset: RulesetDef = world.ruleset ?? {};
  const { d20, ...rest } = ruleset;
  return {
    ...(JSON.parse(JSON.stringify(rest)) as JsonObject),
    ...(d20 !== undefined ? { d20: d20Summary(world, d20) } : {}),
    checks: Object.keys(world.checks) as JsonValue,
    actions: [...actions] as JsonValue,
    bestiary: bestiaryOf(world).map((r) => ({ ...r }) as unknown as JsonValue),
  };
}

/** The ruleset as a chat plays it, which `world_query` gives at `ruleset` and `ruleset_read` a part of: its data with every action the chat is offered, the packs' among them (`offeredActions`), by id in order. */
export function rulesetPlayed(registry: Registry, world: WorldDoc, state: Parameters<Registry["context"]>[1]): JsonObject {
  return rulesetData(world, [...offeredActions(registry, registry.context(world, state)).keys()].sort());
}

/** A part of the ruleset as its index lists it (plan 3.2 §6.6): its name, how many entries it holds where it is a list or keyed by id, and with a counter its size in tokens. (A type, not an interface, so it is a template's fields.) */
export type RulesetPart = { part: string; entries?: number; tokens?: number };

/** The ruleset's parts: each part of `rulesetData` at its top, in its order, with its size where a counter is given. */
export function rulesetParts(ruleset: JsonObject, tokens?: (text: string) => number): RulesetPart[] {
  return Object.entries(ruleset).map(([part, value]) => ({
    part,
    ...(Array.isArray(value) ? { entries: value.length } : typeof value === "object" && value !== null ? { entries: Object.keys(value).length } : {}),
    ...(tokens !== undefined ? { tokens: tokens(JSON.stringify(value)) } : {}),
  }));
}

/** A name as an entry is asked for by: trimmed, case ignored. */
const asked = (text: string): string => text.trim().toLowerCase();

/**
 * One entry of a ruleset part, by its id or name: of a part keyed by id, that key's value; of a list of records, the one whose id,
 * name or label it is; of a list of words, the word itself. Undefined where the part holds none by it, or holds no entries.
 */
export function rulesetEntry(value: JsonValue | undefined, said: string): JsonValue | undefined {
  const want = asked(said);
  if (Array.isArray(value)) {
    return value.find((entry) => {
      if (typeof entry === "string") return asked(entry) === want;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
      return ["id", "name", "label"].some((key) => typeof entry[key] === "string" && asked(entry[key]) === want);
    });
  }
  if (typeof value !== "object" || value === null) return undefined;
  const key = Object.keys(value).find((k) => asked(k) === want);
  return key === undefined ? undefined : value[key];
}
