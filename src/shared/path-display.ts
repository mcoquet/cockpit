// Display helper for long locations (#18). Pure so it can be unit-tested.

/**
 * Splits a path into `head` (everything before the last folder) and `tail`
 * (the last folder, with its leading slash). The popup lets the head shrink
 * with an ellipsis and keeps the tail whole, so a long location truncates in
 * the middle and the folder that matters stays visible. A trailing slash is
 * dropped; `head + tail` rebuilds the rest of the path.
 */
export function splitPathForDisplay(path: string): { head: string; tail: string } {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const cut = trimmed.lastIndexOf('/');
  if (cut <= 0) return { head: '', tail: trimmed };
  return { head: trimmed.slice(0, cut), tail: trimmed.slice(cut) };
}
