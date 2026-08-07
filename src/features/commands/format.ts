const MAX_DESCRIPTION = 4096;
const MORE_RESERVE = 32;

/**
 * Join lines with blank-line separators without exceeding Discord's 4096-char
 * embed-description limit; overflow lines are dropped and counted in a
 * trailing "*+N more <noun>*" marker instead of failing the whole reply.
 */
export function joinCapped(lines: string[], noun: string): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const cost = (kept.length > 0 ? 2 : 0) + line.length;
    if (length + cost > MAX_DESCRIPTION - MORE_RESERVE) break;
    kept.push(line);
    length += cost;
  }
  const omitted = lines.length - kept.length;
  return omitted > 0 ? `${kept.join("\n\n")}\n\n*+${omitted} more ${noun}*` : kept.join("\n\n");
}
