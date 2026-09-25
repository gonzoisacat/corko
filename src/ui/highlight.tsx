import type { ReactNode } from "react";

/* Wrap the first case-insensitive match of `query` in <mark>. Pure --
 * no hooks -- so it is safe to call during render of any node. */
export function renderHighlight(text: string, query: string, matchCase = false): ReactNode {
  if (!query) return text;
  const i = matchCase ? text.indexOf(query) : text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}
