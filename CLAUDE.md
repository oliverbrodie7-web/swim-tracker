# Swim tracker

This app follows Ollie's personal app standard in `~/.claude/CLAUDE.md`. Read that first. What follows is only what is specific to this project.

## Live

- App: https://oliverbrodie7-web.github.io/swim-tracker/
- Repo: https://github.com/oliverbrodie7-web/swim-tracker, Pages serves `main` at root

## Data

Supabase table `public.swims` at `https://wifuhcqpmvixipxejanb.supabase.co`.

Columns: `id` (uuid, generated), `swim_date` (date), `metres` (int), `unbroken_metres` (int, nullable), `time_seconds` (int, nullable), `rpe` (numeric, nullable), `warm_up` (text, nullable), `notes` (text, nullable), `created_at` (timestamptz).

Do not create or modify the table. Row level security already allows the anon key to select, insert, update and delete.

## Goal maths

- Target is 100,000 metres across 2026
- Baseline is the sum of all swims dated before `2026-08-01`, computed from the data rather than hardcoded. It was 35,225 m at launch
- The weekly plan lives in the `PLAN` array at the top of `app.js` as `[week ending Sunday, target metres, label]`. Cumulative targets land exactly on 100,000 at the week ending 2026-11-29, and December weeks are reserve with a target of 0
- Weeks end on Sunday. A swim dated on a Sunday belongs to the week ending that Sunday
- Ahead or behind equals total swum minus the cumulative target of the most recent **completed** week. The lane marker on the dashboard interpolates within the current week, which is deliberately different from the badge figure

## Things that will bite you

- `swim_date` is a plain string. See the dates section of the standard. Every helper for this lives at the top of `app.js`
- Bump `CACHE_VERSION` in `sw.js` before every deploy or the change will not reach his phone
- Charts are only built when the Insights tab is first opened, and are rebuilt when `chartsDirty` is set. Destroy the old Chart instance before creating a new one on the same canvas
