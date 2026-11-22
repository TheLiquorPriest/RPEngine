// Where the tokens went (plan §4 "The pages show"): the turn's model calls from the rows RPE keeps of them, agent by agent, call by
// call, part by part. What each agent was handed as it started; each call's tokens and what they weigh; a call whose request went
// out after the reply was released, marked so; a call that read nothing from the provider's cache and wrote it again, marked with
// why; what an agent did to its own window (plan 3.2 §7.2), between the calls it fell between, with what it spares each later call
// and what it took once; and the jobs the turn's runs started, each with its own use. It names the agents, so it sits behind the
// spoiler gate, and is read from the turn's use route once the gate is open. Tokens, and tokens weighed: never money, and no figure
// is called good or bad.

import type { AgentUse, CallShown, JobUse, TurnReply, TurnUseReply } from "../../../../shared/api";
import { Badge, Disclosure, Row } from "../../../../frontend/components";
import { clock, counted, duration, num, tokenWords, when } from "../../../words";
import { JOB_STATE_WORDS } from "../../jobs/words";
import { operationWords, partWords, SENT_FROM_WORDS, spentLine, tokensLine, WeightsNote } from "../../usage/words";
import type { TurnSection } from "../types";

/** Why a call wrote the provider's cache again, as its record says. */
const COLD_WORDS = {
  lapsed: { mark: "cold write: the cache had lapsed", why: "It read nothing from the provider's cache and wrote it again: more time had passed since its agent's last request went out than the lifetime that request asked." },
  changed: { mark: "cold write: what the cache is keyed on changed", why: "It read nothing from the provider's cache and wrote it again, though no more time had passed than the lifetime asked: something the provider keys its cache on had changed." },
  unknown: { mark: "cold write", why: "It read nothing from the provider's cache and wrote it again, though its agent had sent this front before." },
} as const;

const ASKED_WORDS: Readonly<Record<NonNullable<CallShown["cache"]>["asked"], string>> = { none: "asked no cache", short: "asked the cache's short lifetime", long: "asked the cache's long lifetime" };

/** Whether a call's request went out after its run released the reply. */
export function afterReply(call: Pick<CallShown, "started">, released: number | null): boolean {
  return released !== null && call.started >= released;
}

function CallLine(props: { call: CallShown; released: number | null }) {
  const { call } = props;
  const after = afterReply(call, props.released);
  const cold = call.cache?.cold === true ? COLD_WORDS[call.cache.cause ?? "unknown"] : null;
  const tokens = tokensLine({ input: call.input, cacheRead: call.cacheRead, cacheWrite: call.cacheWrite, cacheWriteLong: call.cache?.asked === "long" ? call.cacheWrite : 0, output: call.output, reasoning: call.reasoning });
  return (
    <li class="rpe-use-call" data-call={call.n} data-after-reply={after ? "yes" : undefined} data-cold={cold === null ? undefined : (call.cache?.cause ?? "yes")}>
      <span class="rpe-use-call-head">
        <strong>Call {call.n}</strong>
        <span>
          {operationWords(call.operation)}
          {call.purpose === null ? "" : `, for ${call.purpose}`}
        </span>
        <span class="lre-num">
          {clock(call.started)}, {duration(call.ended - call.started)}
        </span>
        <span>
          {call.model} on {call.connection}
          {call.effort === null ? "" : `, ${call.effort} effort`}
        </span>
        {after ? <Badge title="Its request went out after the turn's reply was released to the chat.">after the reply</Badge> : null}
        {cold === null ? null : (
          <Badge tone="warn" title={cold.why}>
            {cold.mark}
          </Badge>
        )}
        {call.error === null ? null : (
          <Badge tone="neg" title={call.error}>
            failed
          </Badge>
        )}
      </span>
      <span class="rpe-meta lre-num">
        {tokens} · weighs {num(call.weighted)}
        {call.cache === null ? "" : ` · ${ASKED_WORDS[call.cache.asked]}`}
        {call.sinceLast === null ? "" : ` · ${duration(call.sinceLast)} after its last request ended`} · ended: {call.stop}
      </span>
      {call.parts === null ? (
        <span class="rpe-use-parts" data-totals-only>
          Its row holds its totals alone: its record told no parts (a trace kept before requests were told by part).
        </span>
      ) : (
        <span class="rpe-use-parts" data-parts>
          {call.parts.map((part, i) => (
            <span key={`${part.part}:${part.name ?? ""}:${i}`} data-part={part.part} title={`${num(part.chars)} characters`}>
              {i === 0 ? "" : " · "}
              {partWords(part.part, part.name)} {num(part.tokens)}
            </span>
          ))}
          {call.parts.length === 0 ? "No part was told." : " (tokens by RPH's own estimate)"}
        </span>
      )}
    </li>
  );
}

/** What an agent did to its own window, in the words its line begins with. */
const WINDOW_WORDS: Readonly<Record<AgentUse["window"][number]["action"], string>> = { let_go: "Let go of", note: "Put a note of its own in place of", restore: "Brought back", handoff: "Went on in a fresh window, keeping" };

function WindowLine(props: { change: AgentUse["window"][number] }) {
  const { change } = props;
  const things = change.items.map((item) => `${item.id} (${num(item.tokens)})`).join(", ");
  return (
    <li class="rpe-use-call" data-window={change.action}>
      <span class="rpe-use-call-head">
        <strong>Its window</strong>
        <span>
          {WINDOW_WORDS[change.action]} {things === "" ? "nothing by name" : things}
        </span>
        <span class="lre-num">{clock(change.at)}</span>
      </span>
      <span class="rpe-meta lre-num">
        spares {num(change.spared)} tokens on each later call · took {num(change.once)} once, on its next call (by RPH's own estimate)
      </span>
    </li>
  );
}

function AgentCalls(props: { agent: AgentUse; released: number | null }) {
  const { agent, released } = props;
  const after = agent.calls.filter((call) => afterReply(call, released)).length;
  const cold = agent.calls.filter((call) => call.cache?.cold === true).length;
  // Its calls and what it did to its window between them, in the order they happened. A window change is known by its place in the
  // agent's list: one call can change several things at the same moment, each its own change.
  const steps = [...agent.calls.map((call) => ({ at: call.started, call, change: null, nth: 0 })), ...agent.window.map((change, nth) => ({ at: change.at, call: null, change, nth }))].sort((a, b) => a.at - b.at);
  return (
    <Disclosure
      class="rpe-use-agent"
      summary={
        <span class="rpe-use-head" data-agent={agent.agent}>
          <strong>{agent.plays === null ? agent.definition : `${agent.definition}, playing ${agent.plays}`}</strong>
          <span class="rpe-meta lre-num">{spentLine(agent.spent)}</span>
          {after === 0 ? null : <Badge>{counted(after, "call")} after the reply</Badge>}
          {cold === 0 ? null : <Badge tone="warn">{counted(cold, "cold write")}</Badge>}
          {agent.window.length === 0 ? null : <Badge>{counted(agent.window.length, "change")} to its window</Badge>}
        </span>
      }
    >
      {agent.sent.length === 0 ? null : (
        <ul class="rpe-use-sent" data-sent>
          {agent.sent.map((start) => (
            <li key={start.at} class="rpe-meta">
              Handed as it started, {clock(start.at)}: {start.items.map((item) => `${item.name} ${num(item.tokens)} (${SENT_FROM_WORDS[item.from]})`).join(" · ")}; {num(start.items.reduce((sum, item) => sum + item.tokens, 0))} tokens in all, by RPH's own estimate.
            </li>
          ))}
        </ul>
      )}
      {steps.length === 0 ? (
        <p class="lre-muted rpe-line">No call of its is kept.</p>
      ) : (
        <ul class="rpe-use-calls">
          {steps.map((step) =>
            step.call !== null ? <CallLine key={`c${step.call.n}:${step.call.started}`} call={step.call} released={released} /> : step.change !== null ? <WindowLine key={`w${step.nth}`} change={step.change} /> : null,
          )}
        </ul>
      )}
    </Disclosure>
  );
}

function JobCalls(props: { job: JobUse }) {
  const { job } = props;
  const row = job.job;
  const state = row === null ? null : JOB_STATE_WORDS[row.state];
  // What the rows of its calls add up to; where none is kept, what RPH counted for it.
  const spent = job.spent.calls > 0 ? spentLine(job.spent) : row === null ? "No row of its calls is kept." : `No row of its calls is kept. RPH counted ${counted(row.usage.calls, "call")} · ${tokenWords(row.usage)}.`;
  return (
    <div class="lre-stack" data-job={job.id}>
      <Row
        k={row === null ? "A job whose record RPE no longer keeps" : `Job: ${row.agent}`}
        v={state === null ? undefined : <Badge {...(state.tone === undefined ? {} : { tone: state.tone })}>{state.words}</Badge>}
        sub={`${row === null ? "" : `${row.brief} · started ${when(row.started)} · `}${spent}`}
      />
      {job.agents.map((agent) => (
        <AgentCalls key={`${agent.run}:${agent.agent}`} agent={agent} released={null} />
      ))}
    </div>
  );
}

export function WhereTokens(props: { turn: TurnReply; use: TurnUseReply | null; onOpenSetting?: ((key: string) => void) | undefined }) {
  const { turn, use } = props;
  if (use === null) return <p class="lre-muted rpe-line">Reading the turn's calls…</p>;
  if (use.agents.length === 0 && use.jobs.length === 0) {
    return (
      <p class="rpe-line" data-no-rows>
        No row of this turn's model calls is kept: it was played before RPE kept them, or its rows are past the days they are kept. The Usage page reads in what was played before.
      </p>
    );
  }
  // Each run's reply, by RPH's id for the run: a call that began after it is marked.
  const released = new Map(turn.runs.flatMap((run) => (run.run === null ? [] : [[run.run, run.timings.released] as const])));
  return (
    <div class="lre-stack" data-where-tokens>
      <Row k="Its own runs, every agent together" v={<span class="lre-num">{num(use.spent.weighted)}</span>} sub={spentLine(use.spent)} />
      {use.agents.map((agent) => (
        <AgentCalls key={`${agent.run}:${agent.agent}`} agent={agent} released={released.get(agent.run) ?? null} />
      ))}
      {use.jobs.length === 0 ? null : (
        <>
          <span class="rpe-caption">The jobs it started, each with its own use</span>
          {use.jobs.map((job) => (
            <JobCalls key={job.id} job={job} />
          ))}
        </>
      )}
      <WeightsNote weights={use.weights} onOpenSetting={props.onOpenSetting} />
    </div>
  );
}

export const section: TurnSection = { id: "where-tokens", order: 71, title: "Where the tokens went", spoiler: true, body: ({ turn, use, onOpenSetting }) => (use === undefined ? null : <WhereTokens turn={turn} use={use} onOpenSetting={onOpenSetting} />) };
