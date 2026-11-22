import type { TurnReply } from "../../../../shared/api";
import { Badge, Row } from "../../../../frontend/components";
import { counted, num, tokenWords, when } from "../../../words";
import { JOB_STATE_WORDS } from "../../jobs/words";
import type { TurnSection } from "../types";

/**
 * What the turn spent, all its runs together, and each run's own where there are several; what the kept rows of its calls weigh
 * (plan §4: the weighted figure beside the raw ones); and beside it the jobs its runs started, each with its own use, which is not
 * among the turn's. It shows with the spoiler gate shut, so no agent is named: who spent what is "Where the tokens went", behind it.
 */
function Tokens(props: { turn: TurnReply }) {
  const { usage, runs, jobs, weighted } = props.turn;
  return (
    <div>
      {runs.length > 1 ? <p class="rpe-meta">All its runs together; each run's own is below.</p> : null}
      <Row k="Model calls" v={<span class="lre-num">{usage.calls}</span>} />
      <Row k="Tokens sent" v={<span class="lre-num">{usage.input.toLocaleString("en")}</span>} sub={`${usage.cacheRead.toLocaleString("en")} read from the provider's cache, ${usage.cacheWrite.toLocaleString("en")} written to it`} />
      <Row k="Tokens written" v={<span class="lre-num">{usage.output.toLocaleString("en")}</span>} sub={usage.reasoning === undefined ? undefined : `${usage.reasoning.toLocaleString("en")} of them reasoning`} />
      {weighted === null ? null : <Row k="Weighs" v={<span class="lre-num" data-weighs>{num(weighted.runs)}</span>} sub="Its tokens as one figure, by the weights in your settings; never money. Where the tokens went, behind the spoiler gate, says what the weights are." />}
      {runs.length > 1 ? runs.map((run) => <Row key={run.id} k={`Run ${run.nth}, ${run.id}`} v={<span class="lre-num">{counted(run.usage.calls, "call")}</span>} sub={tokenWords(run.usage)} />) : null}
      {jobs.length === 0 ? null : <p class="rpe-meta">The jobs its runs started, each with its own use, which is not among the turn's.</p>}
      {jobs.map((job) => {
        const state = JOB_STATE_WORDS[job.state];
        const weighs = weighted?.jobs[job.id];
        return (
          <Row
            key={job.id}
            k={
              <span class="lre-inline" data-turn-job={job.id}>
                Job started {when(job.started)} <Badge {...(state.tone === undefined ? {} : { tone: state.tone })}>{state.words}</Badge>
              </span>
            }
            v={<span class="lre-num">{counted(job.usage.calls, "call")}</span>}
            sub={`${tokenWords(job.usage)}${weighs === undefined ? "" : ` · weighs ${num(weighs)}`}`}
          />
        );
      })}
    </div>
  );
}


export const section: TurnSection = { id: "tokens", order: 20, title: "Tokens", spoiler: false, body: ({ turn }) => <Tokens turn={turn} /> };
