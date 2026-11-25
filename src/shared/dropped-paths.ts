// What a terminal window types when files are dropped on it (#5), matching
// iTerm and Terminal.app: each absolute path shell-quoted, separated by
// spaces, then one trailing space so the user can keep typing. No Enter.
import { shellSingleQuote } from './shell-quote';

export function droppedPathsText(paths: string[]): string {
  const words = paths.filter((p) => p.length > 0).map(shellSingleQuote);
  return words.length === 0 ? '' : `${words.join(' ')} `;
}
