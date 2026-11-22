// A table of figures the usage pages share: a name and its figures across where there is room, and each figure on a line of its
// own with its column's name before it where there is not (the drawer, a phone). Which it is follows the room the table itself
// has, not the window's, so one component serves both shells.

import type { ComponentChildren } from "preact";

export interface FigureColumn {
  id: string;
  /** The column's name: its head across, and the words before each figure where the rows stack. */
  head: string;
}

export interface FigureRow {
  id: string;
  name: ComponentChildren;
  /** One cell for each column, in the columns' order. */
  cells: readonly ComponentChildren[];
  /** The span shown holds none of it: it is listed for what it was in the span before. */
  gone?: boolean;
}

export function Figures(props: { of: string; first: string; columns: readonly FigureColumn[]; rows: readonly FigureRow[] }) {
  const { columns } = props;
  return (
    <div class="rpe-figures" data-figures={props.of} data-cols={columns.length}>
      <div class="rpe-figures-row rpe-figures-head" aria-hidden="true">
        <span>{props.first}</span>
        {columns.map((column) => (
          <span key={column.id}>{column.head}</span>
        ))}
      </div>
      {props.rows.map((row) => (
        <div key={row.id} class="rpe-figures-row" data-row={row.id} data-gone={row.gone === true ? "yes" : undefined}>
          <span class="rpe-figures-name">{row.name}</span>
          {columns.map((column, i) => (
            <span key={column.id} class="lre-num" data-cell={column.id}>
              <span class="rpe-figures-label">{column.head} </span>
              {row.cells[i]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
