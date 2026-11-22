// The lore's routes (plan §9.1, §14), declared in the route form (`src/app/routes.ts`) so that the pages'
// types and the API reference are written from them: the lore Lumiverse activated for a turn's prompt,
// each entry by the id the lore map gives it beside Lumiverse's own. The floor's measure and the Turn page
// read it. It answers only for the user this RPE belongs to, from the one reader of `./activated.ts`.

import type { ActivatedLore } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, route, shape } from "../app";
import { JoinedTurnError, type Store } from "../store";
import { type ActivatedLoreDeps, type ActivatedLoreEntry, activatedLore } from "./activated";
import { HOWS } from "./lore";
import { LORE_RECEIPTS, type LoreHeld, type LoreReceipt } from "./sources";

export const TURN_LORE_PATH = "/api/v1/chats/:chat/turns/:turn/lore";

const T = shape.text();
const field = shape.field;

const how = shape.named("LoreActivation", "How Lumiverse activated an entry: always on, by one of its keys, by meaning, or still in force from an earlier turn.", shape.oneOf(...HOWS));
type HowMirrored = Holds<Exactly<Infer<typeof how>, NonNullable<ActivatedLore["how"]>>>;

const activatedRow = shape.named(
  "TurnLoreRow",
  "An entry Lumiverse activated for a turn's prompt: its lore map id, its id and its book's id in Lumiverse, its title, how it activated where the turn's tag says, what RPE's check of the lore on receipt did to it, its size, how it stood against the turn before, and what the turn's lead did with it.",
  shape.object({
    id: field(T, "The id the Author's lore map gives the entry: `e-` and its number."),
    entry: field(T, "Lumiverse's id of the entry."),
    book: field(T, "Lumiverse's id of its book; empty where the tag does not say."),
    title: field(T, "Its title as Lumiverse gave it."),
    how: field(shape.nullable(how), "How it activated; null where the tag does not say."),
    receipt: field(
      shape.nullable(shape.oneOf(...LORE_RECEIPTS)),
      "Where the extension applied its own verdict on the secrets and RPE checked the lore on receipt: kept out of the prompt, worded otherwise, or its text not found in the prompt (so RPE's verdict was not applied to it); null where the check left it as it was, or nothing was checked.",
    ),
    tokens: field(shape.nullable(shape.whole({ least: 0 })), "The size of its text as the prompt carried it, in tokens as the chat counts them; null where its text was not found in the prompt, or the turn kept no list of what its prompt held."),
    status: field(
      shape.nullable(shape.oneOf("new", "changed", "same")),
      "Against the prompt of the turn before it on its path: new to the prompt, its text changed, or as it was; null where that turn kept nothing to compare with (the chat's first turn, or one played before RPE kept any).",
    ),
    lead: field(shape.nullable(shape.oneOf("kept", "let_go")), "What the turn's lead did with it by the end of its run: kept it whole in its window, or let it go to one line; null where the turn's trace is not kept."),
  }),
);
type RowMirrored = Holds<Exactly<Omit<Infer<typeof activatedRow>, "receipt" | keyof LoreHeld>, ActivatedLoreEntry>>;
type HeldMirrored = Holds<Exactly<Pick<Infer<typeof activatedRow>, keyof LoreHeld>, LoreHeld>>;
type ReceiptMirrored = Holds<Exactly<NonNullable<Infer<typeof activatedRow>["receipt"]>, LoreReceipt>>;

export const turnLoreReply = shape.named(
  "TurnLoreReply",
  "The lore Lumiverse activated for a turn's prompt, in the order the turn's tag lists it; none for a turn RPE holds no tag for.",
  shape.object({ entries: shape.list(activatedRow) }),
);
export type TurnLore = Infer<typeof turnLoreReply>;

/** The checks above hold, and are read by no one. */
export type Mirrors = [HowMirrored, RowMirrored, ReceiptMirrored, HeldMirrored];

export interface LoreRoutesDeps extends ActivatedLoreDeps {
  /** RPE's store: whether a turn was joined to another. */
  store: Store;
}

export function loreRoutes(deps: LoreRoutesDeps) {
  return [
    route({
      method: "GET",
      path: TURN_LORE_PATH,
      access: "page",
      group: "lore",
      does: "The lore Lumiverse activated for a turn's prompt, in the tag's order: each entry's lore map id, its id and book in Lumiverse, its title and how it activated where the tag says; none for a turn RPE holds no tag for, or one of another chat.",
      reply: turnLoreReply,
      joined: true,
      handle: async ({ user, params }): Promise<TurnLore> => {
        // A turn joined to another (a continue's held turn) is answered as a fact, for the server to answer in its one place.
        const row = deps.store.user(user).turn(params.turn);
        if (row !== null && row.chat === params.chat && row.joined !== null) throw new JoinedTurnError(params.turn, row.joined);
        const receipt = (await deps.turns.receipt?.(user, params.chat, params.turn)) ?? null;
        const held = (await deps.turns.held?.(user, params.chat, params.turn)) ?? null;
        return {
          entries: (await activatedLore(deps, user, params.chat, params.turn)).map((e) => ({ ...e, receipt: receipt?.get(e.entry) ?? null, tokens: null, status: null, lead: null, ...held?.get(e.id) })),
        };
      },
    }),
  ] as const;
}
