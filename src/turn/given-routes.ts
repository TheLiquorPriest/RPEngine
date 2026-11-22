// The Agents page's route of what each agent is given by name (plan §14, the Agents row: "what each is given"; §5.4 `given:`; plan 3.2
// §6.3, purposes): for a chat, every definition in force with each name its `given:` lists and each name of each purpose it has
// (`purposes:`), the kind of thing the name is (RPH's own: a file, a stretch of the chat, a lore entry, a slice of the prompt; or one of
// RPE's views: of the world, the story, the cast, the turn, the lore index, the ruleset, the map, or a view another area adds), and
// whether RPE gives it at the chat's newest turn and how large it is there, read through the resolver the turn uses (`givenViews`) as
// a preview, so nothing is kept of the reading and a name nothing provides is listed as missing. RPH's own kinds are found by RPH at
// the run: they are shown as its, never read or measured here.

import type { AgentRef } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import type { Turns } from "./lane";
import { CARRIED_SESSION, type RunRecord } from "./runs";
import { turnSettings } from "./settings";
import { NO_SESSION, tokenCount } from "./turns";

const T = shape.text();

const GIVEN_KINDS = ["file", "chat", "lore", "prompt", "world", "story", "cast", "turn", "index", "ruleset", "map", "view"] as const;
type GivenKind = (typeof GIVEN_KINDS)[number];

/** The kinds RPH finds itself (`rp-harness`'s attachments): the host is never asked for them. */
const RPH_KINDS: Readonly<Partial<Record<GivenKind, true>>> = { file: true, chat: true, lore: true, prompt: true };

/**
 * The names RPH gives of its own turn, which the host is never asked for either: the lead's briefing and what its session carries,
 * and a thing of the window of the agent that starts another (a section of its briefing, the answer of a call of its own).
 */
const RPH_OWN = /^(?:briefing|session:carry|carry|briefing:.+|call:.+|work:.+\.\..+|given:.+)$/;

/** Whether RPH finds a name itself, at the run. */
function rphFinds(name: string): boolean {
  return RPH_KINDS[kindOf(name)] === true || RPH_OWN.test(name);
}

/** What kind of thing a name an agent is given is, by its form. */
function kindOf(ref: string): GivenKind {
  const prefixed = (["file", "lore", "prompt", "world", "story", "cast", "turn", "index", "map"] as const).find((kind) => ref.startsWith(`${kind}:`));
  if (prefixed !== undefined) return prefixed;
  if (ref.startsWith("chat:history[")) return "chat";
  return ref === "ruleset" ? "ruleset" : "view";
}

const givenName = shape.named(
  "GivenName",
  "A name a definition's `given:`, or one of its purposes, lists: what kind of thing it is, who finds it (RPH its own kinds, RPE its views), whether RPE gives it at the chat's newest turn (null for RPH's, found at the run), and its size there in tokens, at the chat's characters to a token (null for RPH's and for a name nothing provides).",
  shape.object({ name: T, kind: shape.oneOf(...GIVEN_KINDS), by: shape.oneOf("rph", "rpe"), found: shape.nullable(shape.yesNo()), tokens: shape.nullable(shape.number()) }),
);

const givenReply = shape.named(
  "GivenReply",
  "What each agent definition in force for a chat is given by name, for a start that names no purpose (`given`) and for each purpose a start may name (`purposes`: each with what the definition hands a start for it in place of `given`), read at the chat's newest turn (null: it has none yet) with each name's size there, and the names of RPE's that nothing provides.",
  shape.object({
    chat: T,
    turn: shape.nullable(T),
    definitions: shape.list(
      shape.object({
        name: T,
        off: shape.yesNo(),
        given: shape.list(givenName),
        purposes: shape.list(shape.object({ name: T, given: shape.list(givenName) })),
        missing: shape.list(T),
      }),
    ),
  }),
);

export function givenRoutes(turns: Turns) {
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/given",
      access: "page",
      group: "agents",
      does: "What each agent definition in force for a chat is given by name, each name's kind and whether it resolves at the chat's newest turn as the turn would give it, and the names nothing provides.",
      reply: givenReply,
      handle: async ({ user, params }) => {
        const store = turns.store.user(user);
        // The newest turn on the path that RPE ran, read in the session it played in; a turn a migration carried played in none.
        const path = store.path(params.chat);
        let run: RunRecord | null = null;
        for (let at = path.length - 1; at >= 0 && run === null; at--) {
          const turn = path[at]?.turn ?? null;
          const record = turn === null ? null : turns.runs.record(user, turn);
          run = record === null || record.session === CARRIED_SESSION ? null : record;
        }
        const turn = run?.turn ?? null;
        const scope = run === null ? { user, chat: params.chat, session: NO_SESSION } : { user, chat: params.chat, session: run.session, turn: run.turn };
        const definitions = await turns.harness.definitions.list(scope);
        const tokens = tokenCount((await turnSettings(turns.files, scope, turns.env.log)).charsPerToken);
        return {
          chat: params.chat,
          turn,
          definitions: await Promise.all(
            definitions.map(async (d) => {
              const agent: AgentRef = { id: d.name, definition: d.name };
              const purposes = Object.entries(d.purposes ?? {});
              const named = [...new Set([...d.given, ...purposes.flatMap(([, names]) => names)])];
              const ours = named.filter((name) => !rphFinds(name));
              // Read as a preview: nobody is started, so nothing is kept of it (the indexer's batch is held for no one).
              const read = new Map((await turns.given(scope, agent, ours, { task: "", preview: true })).map((g) => [g.ref, g.text]));
              const shown = (name: string) => {
                const kind = kindOf(name);
                const rph = rphFinds(name);
                const text = rph ? null : (read.get(name) ?? null);
                return { name, kind, by: rph ? ("rph" as const) : ("rpe" as const), found: rph ? null : text !== null, tokens: text === null ? null : tokens(text) };
              };
              const given = d.given.map(shown);
              const byPurpose = purposes.map(([name, names]) => ({ name, given: names.map(shown) }));
              const missing = [...new Set([...given, ...byPurpose.flatMap((p) => p.given)].flatMap((g) => (g.found === false ? [g.name] : [])))];
              return { name: d.name, off: d.off, given, purposes: byPurpose, missing };
            }),
          ),
        };
      },
    }),
  ] as const;
}
