# Schedules run inside Cockpit, not in a system scheduler

_Recorded retroactively on 2026-11-25. Evidence: `docs/plans/2026-02-13-cron-scheduling-design.md` ("Runtime: Only while Cockpit is running") and as recalled by Miguel Coquet._

Schedules are timed with node-cron inside Cockpit's main process, not registered with launchd or cron. Cockpit is meant to start at login and stay running, so keeping its schedules inside it feels natural and self-contained, and it leaves the system's schedulers untouched. The trade-off is that schedules fire only while Cockpit is running, and anything queued in memory is lost when it quits.
