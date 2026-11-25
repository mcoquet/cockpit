// Pure shell quoting, shared by the main process (Cmd+T, #52) and the
// terminal renderer (dropped files, #5). Kept free of Electron so it can be
// unit-tested.

/** Quote a string as one shell word: '…' with each ' written as '\''. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
