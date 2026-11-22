// The usage pages' own rules (the Usage page, and the Turn page's "Where the tokens went"), under `rpe-`. A table of figures stacks
// each row's figures two to a line with their columns' names, and lays them across in columns once the table itself is wide enough
// (a container query: the drawer is narrow whatever the window is). A call is a few lines under its agent.

export const USAGE_PAGE_CSS = `
.rpe-use-span{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2) var(--lre-s3);min-width:0}
.rpe-use-count{width:7em}
.rpe-use-weights{gap:var(--lre-s1)}
.rpe-figures{container-type:inline-size;display:flex;flex-direction:column;min-width:0}
.rpe-figures-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 var(--lre-s3);padding:var(--lre-s2) 0;border-top:1px solid var(--lre-hairline);font-size:var(--lre-fs-sm);min-width:0}
.rpe-figures-row:nth-child(2){border-top:0}
.rpe-figures-head{display:none}
.rpe-figures-name{grid-column:1/-1;font-weight:600;overflow-wrap:anywhere}
.rpe-figures-label{color:var(--lre-muted)}
.rpe-figures-row[data-gone=yes]{color:var(--lre-muted)}
.rpe-figures-row>[data-cell]{overflow-wrap:anywhere}
@container (min-width:760px){
.rpe-figures-row{align-items:baseline}
.rpe-figures[data-cols="4"] .rpe-figures-row{grid-template-columns:minmax(0,3fr) repeat(4,minmax(0,1fr))}
.rpe-figures[data-cols="5"] .rpe-figures-row{grid-template-columns:minmax(0,3fr) repeat(5,minmax(0,1fr))}
.rpe-figures[data-cols="7"] .rpe-figures-row{grid-template-columns:minmax(0,2fr) repeat(7,minmax(0,1fr))}
.rpe-figures[data-cols="8"] .rpe-figures-row{grid-template-columns:minmax(0,2fr) repeat(7,minmax(0,1fr)) minmax(0,1.6fr)}
.rpe-figures-row>[data-cell],.rpe-figures-head>span:not(:first-child){text-align:right}
.rpe-figures-head{display:grid;border-top:0;color:var(--lre-muted);font-weight:600}
.rpe-figures-row:nth-child(2){border-top:1px solid var(--lre-hairline)}
.rpe-figures-name{grid-column:auto}
.rpe-figures-label{display:none}
}
.rpe-use-agent>.lre-disclosure-body{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.rpe-use-head{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.rpe-use-calls,.rpe-use-sent{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;min-width:0}
.rpe-use-call{display:flex;flex-direction:column;gap:2px;padding:var(--lre-s2) 0;border-top:1px solid var(--lre-hairline);min-width:0}
.rpe-use-call-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--lre-s1) var(--lre-s2);font-size:var(--lre-fs-sm);min-width:0}
.rpe-use-parts{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
`;
