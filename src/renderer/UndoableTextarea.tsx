import { useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { Ref, TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue'> & {
  value: string;
  ref?: Ref<HTMLTextAreaElement | null>;
};

/**
 * A `<textarea>` that keeps the browser's undo grouping (#33).
 *
 * React keeps a controlled `<textarea>` in sync by writing `defaultValue` (its text
 * child) on every change. That DOM write closes Chromium's typing undo group, so Cmd+Z
 * removes one character at a time. Here React never gets a `value` prop; the text
 * the user types stays in the element, and only changes made by the app (clearing,
 * loading a project) are written to `el.value`. Use it like a controlled textarea,
 * with one rule: `onChange` must store `e.target.value` as is. It cannot reject or
 * rewrite input the way a controlled textarea can (the typed text would stay).
 */
export default function UndoableTextarea({ value, ref, ...rest }: Props) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

  useLayoutEffect(() => {
    const el = inner.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);

  return <textarea ref={inner} {...rest} />;
}
