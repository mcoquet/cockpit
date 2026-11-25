# Embedded terminal that runs claude directly

_Recorded retroactively on 2026-11-25. Evidence: commit af2054e ("replace iTerm2 with embedded xterm.js terminal"), `docs/plans/2026-02-02-cockpit-design.md` (phase 2), and as recalled by Miguel Coquet._

Cockpit first opened Claude Code in iTerm2 windows driven by AppleScript. We replaced that with our own terminal windows: xterm.js in an Electron window, backed by node-pty, with the `claude` binary as the PTY's process rather than a shell. A JavaScript terminal is one we control fully (input handling, links, badges, notifications), and running `claude` directly means Cockpit starts and stops Claude Code itself instead of opening a terminal and typing commands into it. As a result a terminal window and its Claude Code process live and die together, and Cockpit depends on a native module (`node-pty`) that must be rebuilt for each Electron version.
