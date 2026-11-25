# A project is identified by its path relative to home

_Recorded retroactively on 2026-11-25. Evidence: `docs/plans/2026-02-02-cockpit-design.md` ("Data Model & Storage") and as recalled by Miguel Coquet._

A project has no separate ID: its folder's path relative to the user's home folder is its identity (a folder outside home is stored as an absolute path), and everything else (schedules, the restore set, the active terminal session, Claude Code's conversation folder) is keyed by it. Claude Code work is tied to a local working directory, so the folder is the natural identity. The consequences are that a project cannot be moved or renamed on disk without being re-added, and every place that turns the stored path back into a full path has to expand it the same way.
