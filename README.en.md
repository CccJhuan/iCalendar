# iCalendar

[Chinese](README.md) | [English](README.en.md)

iCalendar is a local schedule and task management plugin for Obsidian. It reads Markdown tasks from your vault, organizes dated tasks into month, week, and day views, and provides an unscheduled task inbox, drag-and-drop planning, priority editing, tag filters, and daily task reminders.

The plugin runs locally by default. It does not upload note content and does not depend on any cloud service.

## Highlights

- Month, week, and day views: move from high-level planning to a focused daily task list.
- Dataview task aggregation: read tasks from your vault and refresh the board when Dataview metadata changes.
- Unscheduled task inbox: collect unfinished tasks without dates, and quickly add new tasks to a configurable inbox file.
- Drag-and-drop scheduling: drag a task to a date to add or update its date field; batch move overdue or unscheduled tasks to today.
- Priority board: group tasks by file/project or priority, and drag tasks to the priority dock to update their priority.
- Progress tracking: view daily, weekly, and monthly completion progress, with configurable priority weights.
- Tag filtering: filter the current view by tasks that include any selected tag, include all selected tags, or exclude selected tags.
- Complete and undo: check off tasks from the board, sync changes back to the original Markdown line, and undo recent changes from the notice.
- Daily task reminders: set up to three reminder times and see a modal with today's remaining tasks.

## Requirements and compatibility

- Required: Obsidian and the Dataview plugin. iCalendar reads task data through the Dataview API.
- Recommended: the Tasks plugin. When available, iCalendar uses the Tasks API for task toggling; otherwise it falls back to a built-in simple toggle.
- The plugin can be loaded on desktop and mobile, but the dense calendar board is best suited for desktop or larger screens.

## Task syntax

iCalendar reads Markdown task lines and recognizes common Tasks/Dataview-style markers:

```markdown
- [ ] Write weekly report 📅 2026-06-05 🔼 #work
- [ ] Prepare meeting notes ⏳ 2026-06-06 ⏫ #project/a
- [ ] Leave for the airport 🛫 2026-06-07 🔺
- [x] Finished task ✅ 2026-06-04
- [-] Cancelled task 📅 2026-06-08
```

Supported date markers:

- `📅 YYYY-MM-DD`
- `⏳ YYYY-MM-DD`
- `🛫 YYYY-MM-DD`
- `✅ YYYY-MM-DD`, used as the completion date for finished tasks

Supported priority markers:

- `🔺` highest
- `⏫` high
- `🔼` medium
- no marker for normal
- `🔽` low
- `⏬` lowest

If a task has no explicit date, but Dataview can identify the source note as a dated daily note, iCalendar uses the file date as the task date. Undone tasks without a date are shown in the unscheduled task inbox.

## Usage

1. Install and enable Dataview.
2. Enable iCalendar.
3. Open the board from the left ribbon calendar icon or the **Open calendar view** command.
4. Switch between **Month**, **Week**, and **Day** from the top toolbar.
5. Create tasks with the quick input field, or drag tasks from the unscheduled inbox onto calendar dates.

## Settings

Configure iCalendar from **Settings → Community plugins → iCalendar**:

- Inbox file path: new tasks from the quick input field are written to this Markdown file. The default is `Inbox.md`.
- Default view: choose month, week, or day as the initial board view.
- Default grouping mode: group week/day tasks by file/project or priority.
- Task density: choose standard or compact cards.
- Daily task reminders: enable reminders and set up to three 24-hour reminder times.
- Performance weights: configure how much each priority level contributes to progress calculations.

## Data and privacy

iCalendar only reads and writes Markdown files inside the current Obsidian vault:

- Task data is read from Dataview's local index.
- Quick-added tasks are written only to your configured inbox file.
- Drag scheduling, completion changes, and priority edits update the original Markdown task line.
- The plugin does not include telemetry, ads, remote scripts, or custom auto-update logic.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

For release or manual installation, place `main.js`, `manifest.json`, and `styles.css` in the corresponding Obsidian plugin folder.
