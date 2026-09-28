// Small text helpers shared by the labels the viewer writes.

/**
 * Shorten a label to n characters. Cuts at the last space when one is reasonably near the end, so
 * a title lands on "…where to put a" rather than "…where to put a h", and always says it was cut.
 */
export function ellipsis(s, n) {
  const text = String(s ?? '').trim();
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const space = cut.lastIndexOf(' ');
  return `${(space > n * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
