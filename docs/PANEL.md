# Web panel

[← Back to README](../README.md)

The plugin can also draw the month and the week inside the DSH Web GUI. The panel
is optional in both senses: nothing appears until you open it, and a profile can
switch its entry point off entirely.

![The Dayflow month calendar in the dsh right Sidebar](panel.en.png)

## Month calendar

- Open it from the **Dayflow** button in the conversation header. It collapses to
  an icon when the header runs out of room.
- Every day is one segmented ring: each arc is a category, sized by its share of
  the day and drawn in the user's own colours. The centre shows the date and the
  tracked time.
- **A day's state is never faked.** A day with no captures draws only a faint
  dotted track; a captured day with nothing to show draws a plain track; a day
  whose analysis is still queued pulses amber; a recorded day draws its arcs.
  Missing data is not zero activity.
- **The calendar also marks the user's own records, read-only.** A day with a
  stored goal carries a compact goal marker, and a day with review marks
  carries a few small rating dots in the focused, neutral, and distracted
  colours, labelled with the full count; the day's hover card adds the goal
  summary plus each mark's time range and label. A day with neither draws no
  marker, no dot, and no placeholder, so a profile without goals or marks looks
  exactly as before. Both arrive inside the existing `GET /api/dayflow/month`
  answer — the same records and semantics as the day view, with `goal` `null`
  and `ratings` `[]` when the user recorded nothing — so the calendar adds no
  request, no route, no entry point, and no model call: the panel stays at its
  **18 host Fetch routes**.
- Hovering a day shows its total, category split, and the two longest activities;
  hovering one arc shows that category's name, duration, and share. The card
  clamps to the viewport and flips above the anchor near the bottom edge.
- Clicking a day opens it: totals, filter chips, and the timed activity list.
  Clicking a chip filters the list; **Clear filter** restores it.

## Week swim lanes

A **Month / Week** switch in the header swaps the calendar for Dayflow's own
weekly timeline: seven day columns over one hour axis, each activity drawn as a
card placed at its time and tinted with its category colour.

![The Dayflow week swim lanes](demo.en.png)

- The axis follows the data: it starts an hour before the week's first activity
  and ends an hour after its last, so a workday fills the pane instead of a
  4 AM-to-midnight strip. `−`/`+` zoom the axis.
- Overlapping cards share the column in packed lanes instead of covering each
  other, and a card keeps a minimum height so a five-minute block stays legible.
- Today's column is tinted, its date sits in a filled badge, and the header row
  stays pinned while the week scrolls.
- Hovering a card shows its day, time range, duration, apps, and summary;
  clicking it opens that day's detail. `‹`/`›` step weeks and **This week**
  returns to the current one.
- The week header totals the tracked time, and the category legend above the
  grid names every colour in use.
- Each day column also carries that day's own records in a compact meta row: a
  goal chip when the user set a goal, and small rating dots when they marked
  stretches of the day. A day with neither leaves the row empty instead of
  reserving space, and the row never covers the activity cards; a narrow
  sidebar wraps it. It is read-only like the calendar: no control and no extra
  request, because the fields ride in the existing `GET /api/dayflow/week`
  answer (`goal` `null` and `ratings` `[]` when empty). The panel still has one
  entry, three views, and **18 host Fetch routes**.
- Every card carries the icon of the site or app it was recorded from, and falls
  back to a lettered tile in the category colour when a site has no favicon.

## Day view

![One day open in the panel](day.en.png)

- In the day view, `‹`/`›` step days, `⟳` refreshes, and the back arrow (or
  Escape) returns to the calendar with that day still marked as selected.
- The day view also shows the user's own records for that day: the focus goal
  with its focus and distraction categories, or a quiet "no goal" line, and the
  review marks they made on the timeline. The month and week answers carry the
  same records per day (see above), so their views mark them without another
  fetch; opening a day still shows the full goal card and the review-mark list.
- On touch devices hover is replaced by tap: a tap opens the day, and the back
  control sits in the day header.

## Journal insights

- The panel's month/week switch has a third view, **Journal insights**: it lists
  what the agent has learned — active long tasks (with progress and stalled
  marks), the open review queue, recent date-stamped memory claims, stored
  day/week reflections, the stored day and week **briefs** (read-only; see
  [Briefs in the panel](#briefs-in-the-panel)), and the recent **close history**
  of the scheduled closes (read-only; see
  [Close history in the panel](#close-history-in-the-panel)). It is a view
  inside the panel, not a second tab or button, so the plugin keeps one entry.
  The task, memory, and reflection blocks also take an inline add, and a newly
  added task can be offered a history scan (see
  [Quick capture](QUICK_CAPTURE.md)); the review queue has no add row — its
  items are the agent's proposals — but each one can be decided in place, and a
  task session can be unlinked (see below).
- Above those sections sit three quiet status lines. The first is the native
  capture strip (permission, today's frame count, Pause/Resume). The second
  reports the **analysis worker** as read-only: off, waiting for consent, a
  missing provider or model, paused with capture, running, idle, or a stopped
  worker; today's failed count; the call and token budget (for example
  `3/120 calls · 12k/200k tokens`); and the last job's local time. Once a
  consent lets analysis call a model it also states, in one quiet sentence,
  what leaves the machine — the frontmost app, window title, and frame hash,
  never the image — and a `cloud` consent adds that this metadata leaves the
  Mac while no image is sent. It has **no button** — analysis is enabled and
  consented in the profile — so the panel keeps its single entry point and adds
  no second control surface. When the status payload's additive
  `tokenBudgetExhausted` is true, the line turns **amber** and reads
  **Daily token budget reached**, with the hint that analysis resumes tomorrow
  or immediately if `analysis.dailyTokenBudget` is raised — the call that
  crossed the budget was already paid, and a token-budget skip is never
  replayed. That state is drawn before the stopped-worker and running/idle
  tones — the stop is about the day's spend, not the worker — and it is
  still status, not a control — no button, no settings surface, and no new
  route: the panel stays at its 18 host Fetch routes.
- The third line is the **close-state line**: one compact row under the
  analysis line that reads `Day closes 04:00`, the last stored day close and
  its status (`last close Nov 26 complete`), `Week close Mon`, and
  `catch-up 2 days` (the `automation.catchUpDays` window). Its dot is green
  for an enabled schedule (or a close running now), amber when the last day
  close failed, and grey when automation is off; a failed or missing read
  degrades to the quiet grey line instead of an error. Like the analysis line
  it is status, not a control: no button, no new view, no header entry, and
  the copy is in both languages. The weekly close's stored brief carries a
  short **memory health** digest in its body and `payload_json`, and 0.8.1
  makes it readable: the week brief appears in the insights view's **Briefs**
  block with that digest inside its expanded body (see below). The close-state
  line itself still reports only the schedule and the last week close — it adds
  no route, line, or button, and the panel stays at its 18 host Fetch routes.

### Decisions in the panel

- **The review queue is decided in place.** Each waiting item carries an inline
  decision row, matched to its kind: a **distillation** or **loop** offers
  **Keep** (the primary action) and **Discard**; an **improvement** or **task
  proposal** offers **Accept** (primary) and the same **Discard** button, which
  the store records as the kind's negative decision (`discard` or `reject`).
  Accepting a task proposal creates the long task in the same act, and keeping
  a distillation or loop writes the dated memory claim — the panel calls the
  same decision module as `journal_review`, so a click and a tool call leave the
  store in the same state.
- **Don't suggest again asks twice.** The item's row asks one inline question —
  **Hide this for good?** with **Confirm** / **Cancel** (no browser dialog);
  only **Confirm** sends `forever: true` and stores a *hard* suppression, after
  which that proposal fingerprint is dropped on sight. A plain **Discard** is
  *soft*: the agent may propose the same idea again only when the evidence is
  materially new — a different source day, a confidence jump, or more
  occurrences. Clearing a hard suppression stays agent-only (the
  `journal_review` unsuppress action), so the panel deliberately has no
  suppression-management surface.
- **Task sessions can be unlinked.** The history scan still previews, and
  **Link** attaches the confirmed days; in the task row each linked day sits
  under **Linked** with its own **Unlink**, which removes that day's session and
  leaves the day's recorded activities untouched.
- **States are honest.** While a decision is in flight its row disables the
  buttons and says it is working; a failed decision or unlink shows the error
  inline and leaves the row in place; an empty queue keeps its quiet "no items
  waiting" line. The new action, confirmation, and error copy is in both
  languages.
- **Nothing else moved.** Deciding is still the same **Journal insights** view:
  no schema change, no model call, no second tab, and no new header button.

### Briefs in the panel

- The **Briefs** block sits at the end of the **Journal insights** view, after
  the task, review, memory, and reflection sections. It is the reading view for
  the text the automation already stores: the weekly close's briefs (with the
  **memory health** digest) and the native daily standups, which are normalised
  into day briefs so the two kinds share one list.
- Each entry is a collapsed row: a **Day** or **Week** badge, the title, and its
  updated date. Opening a row shows the brief body; the weekly
  `Memory health: …` paragraph is part of that body, not a second surface. An
  entry with an empty body reads as **(untitled)**, like the other rows.
- The block is **read-only**. It has no add row, no decision row, and no button
  beyond expanding a row, so the view keeps its existing controls. The entries
  arrive inside the existing `GET /api/dayflow/insights` answer as the additive
  `briefs` field: the panel adds no request and stays at its **18 host Fetch
  routes** — nine `GET` and nine `POST` — with no tab, header button, or
  settings page, and the plugin keeps its single entry point.
- The list is bounded and ordered: newest period first, at most ten entries, one
  entry per kind and period (a stored brief wins over a standup for the same
  day). A standup deleted in the journal is not shown, and an unreadable stored
  payload is skipped instead of failing the view.
- When nothing has been stored yet the block keeps its quiet **No briefs yet**
  line — a default profile shows an empty Briefs section, exactly like the other
  blocks, and reading it makes no model call.
- That was the 0.8.x line's last panel change: `v0.8.1` added the block, the
  planned `0.8.2` image admission and `0.8.3` Phase 4 cutover are deferred to
  the next line (owner-gated), and `v0.8.4` is a release close with no panel
  change — so the panel keeps its one entry, three views, and 18 host Fetch
  routes.

### Close history in the panel

- The **Close history** block sits at the end of the **Journal insights** view,
  after **Briefs**. It is the reading view for the closes the automation already
  records — the scheduled day close, the Monday-anchored week close, and the
  weekly memory lint — so a failure or a skip inside the catch-up window is
  inspectable instead of showing only on the close-state line.
- Each entry is one row: a job badge (**Day close**, **Week close**, or
  **Lint**), the close's period (the day itself, or the week's date range for a
  week close), the status, the attempt count when the close needed more than one
  (for example `2 attempts`), the error summary when one was recorded, and the
  updated date (a short date whose tooltip reads `Updated Nov 27`). The error is
  one truncated line; the full message stays in its `Error: …` title and
  accessible label.
- Status copy is localized and the tone stays quiet: **Complete** uses the
  normal green status tone, **Failed** and **Skipped** share one restrained
  amber warning tone — a coloured row, never an error banner — and a **Running**
  or **Pending** close stays neutral grey.
- The block is **read-only**. It has no add row, no retry or re-run button, no
  decision row, and no entry of its own, so the view keeps its existing controls
  and the plugin keeps its single entry point.
- The entries arrive inside the existing `GET /api/dayflow/insights` answer as
  the additive `closes` field (`job`, `day`, `status`, `attempts`, optional
  `error`, `updated_at`), so the panel adds no request: still **18 host Fetch
  routes** — nine `GET` and nine `POST` — with no tab, header button, or
  settings page, and no model call.
- The list is bounded and ordered: most recently updated first (ties by row id,
  newest first), at most ten entries. A missing journal answers `[]` and creates
  no file, so a default profile reads an empty list without writing to disk.
- When nothing has been recorded yet the block keeps its quiet **No closes
  recorded yet.** line — a default profile shows an empty Close history section,
  exactly like the other blocks, and reading it makes no model call.

### Automation status

- The close-state line above reads `GET /api/dayflow/automation/status`, which
  answers `{automation: {...}}`:
  - `enabled`, `running` — the profile's `automation.enabled` switch and
    whether a day or week close is running now;
  - `dailyAt`, `weeklyOn`, `catchUpDays` — the schedule and the catch-up
    window (default `04:00`, `monday`, `2`, bounded 1–30);
  - `lastDayClose` / `lastWeekClose` — the last stored close of each as
    `{day, status, at}` and `{monday, status, at}`, absent until one has run;
  - `nextDayCloseAt` — epoch milliseconds of the next scheduled close, absent
    when unknown.
- The scheduler owns the live fields, so the host composition injects the
  builder; without one the route derives the schedule from the `automation`
  block and reports idle. The route is a read: it never opens or creates the
  owned journal, so a fresh profile answers the schedule without a file.
- The line adds no control. Enabling automation, choosing the time or the
  weekday, and setting the catch-up window stay profile edits
  ([CONFIGURATION.md](CONFIGURATION.md)); the panel's single entry point and
  three views are unchanged.

## Panel routes and icons

- The panel reads `GET /api/dayflow/month`, `GET /api/dayflow/week`,
  `GET /api/dayflow/day`, `GET /api/dayflow/insights`, and
  `GET /api/dayflow/panel` (the enablement probe) through the harness's
  authenticated `/api` bridge. The three inline add rows submit
  `POST /api/dayflow/tasks`, `POST /api/dayflow/memory`, and
  `POST /api/dayflow/reflections` on the same bridge, and the post-add history
  scan and its link submit `POST /api/dayflow/tasks/scan` and
  `POST /api/dayflow/tasks/link`. The newer writes are `POST /api/dayflow/review`
  (a review decision) and `POST /api/dayflow/tasks/attach` /
  `POST /api/dayflow/tasks/detach` (one day of a task's sessions). The
  native capture line adds `GET /api/dayflow/capture/status` and
  `POST /api/dayflow/capture/pause`, the analysis line adds
  `GET /api/dayflow/analysis/status`, and the close-state line adds
  `GET /api/dayflow/automation/status` (see
  [Native capture](NATIVE_CAPTURE.md)). Together with the icon route
  below, those are the panel's host Fetch routes — eighteen in all, nine `GET`
  and nine `POST`. The insights answer carries every section of the view, the
  additive `briefs` and `closes` lists included, in that one response, so the
  Briefs and Close history blocks add no request. It never touches the database
  itself.
- The three new writes require `confirm: true` in the body — the same guard the
  `journal_review` tool uses — and answer with the store's own payload:
  - `POST /api/dayflow/review` takes
    `{id, decision: keep | accept | discard | reject, note?, forever?, confirm: true}`
    and answers `{review: {item, task?, memory?}}`; `task` is present when
    accepting a task proposal created it, and `memory` when keeping a
    distillation or loop wrote the claim. An unknown id answers `404`; a
    malformed body or an item that is already decided answers `400`.
  - `POST /api/dayflow/tasks/attach` takes
    `{id, day, minutes, note?, activity_ids?, confirm: true}` — `minutes` is a
    non-negative whole number — and answers `{task}`. Attaching the same day
    again replaces that day's session instead of recording a second one.
  - `POST /api/dayflow/tasks/detach` takes `{id, day, confirm: true}` and answers
    `{task}`; the detached day's recorded activities stay in the journal. An
    unknown task id answers `404`, and detaching a day that was never attached
    is a no-op that still answers with the current task.
- Icons come from `GET /api/dayflow/icon?domain=…`, which fetches one
  `favicon.ico` per domain on first use and caches it under
  `$DSH_HOME/dayflow-icons`. That is the plugin's only outbound request: it
  sends no cookies and no referrer, refuses loopback and bare-IP names, and
  stops entirely with `icons: false`.

## Switching views

- Switching views keeps the selected day, so a day picked in the calendar stays
  marked when you move to the week and back.

## Turning the panel off

Set `panel: false` to remove the header button and the tab type.
