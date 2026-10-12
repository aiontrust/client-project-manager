# Client & Project Manager

A lightweight tool for small businesses and freelancers to keep client contacts, track the projects they run for each client, and plan the work on a calendar.

It runs in the browser with no build step. On its own it saves data in your browser; connect it to [Supabase](https://supabase.com) and your team signs in with Google and shares one workspace that stays in sync.

## Features

**Clients**
- Searchable client list with name, email, phone, company and notes, plus copy buttons.
- Each client's page lists all their projects, with status and due-date warnings.
- Deleting a client asks for confirmation and also removes their projects.

**Projects**
- Board with Pending, In progress and Completed columns, filterable by client.
- Change a project's status from any list with one click.
- Projects due within a week are flagged, and overdue ones are marked in red.
- Attach links to websites or Google Drive files to any project.
- **Add from Drive** (with accounts and Drive set up): pick files from Google Drive. Photos show as previews on project cards and calendar days for the whole team; other files attach as links.

**Calendar**
- **Month view:** project start and due dates, plus your own calendar entries. Click a day to see everything on it or add an entry.
- **List view:** a spreadsheet-style table (Start · Project · Due · Days left · Links · Client · Status), sortable by any column and grouped by month.
- **Calendar entries:** a title, date, notes, an optional project, and any number of website or Drive links.
- **Timeline report:** a company-review overview of every project across 1–12 months, grouped by client or status. Download it as a PDF or PNG.

**Accounts and team sync** (once set up, see below)
- Sign in with Google. Your team shares one workspace of clients, projects and calendar.
- Changes appear on everyone's screen as they happen.
- The workspace owner invites teammates by email from the **Team** panel; they join the first time they sign in.
- If you used the app before signing in, it offers to copy that browser's data into the workspace.

**Your data**
- Without accounts, saved automatically in your browser on the device you use.
- **Download backup** saves everything to a JSON file. **Restore from backup** loads it again, on the same device or a new one.
- **Load example data** fills an empty workspace with sample clients and projects, all marked "Example", so you can try things out.

## Using it

### Online with GitHub Pages

1. In this repository on GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, then click **Save**.
3. After a minute the app is live at `https://aiontrust.github.io/client-project-manager/`.

Each person's data stays in their own browser, so sharing the link shares the tool, not your records.

### On your computer

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm start
```

Then open <http://localhost:8080>. Any static file server works too, for example `python3 -m http.server 8080`.

## Accounts and sync

Follow [docs/supabase-setup.md](docs/supabase-setup.md) to create the Supabase project, set up Google sign-in, and add your project's URL and public key to `js/config.js`. Until then, the app runs in browser-only mode.

Then, for Drive photo previews, follow [docs/google-drive-setup.md](docs/google-drive-setup.md).

## Where data is stored

**With accounts:** in your Supabase project's database. Access rules in `supabase/migrations/` let only a workspace's members see or change its data.

**Without accounts:** in the browser's local storage under the key `cpm.data.v1`. It is not sent anywhere. That means:

- Clearing your browser's site data deletes it, so download a backup regularly.
- A different browser or device starts empty until you restore a backup there.

The same app also runs as a page on claude.ai, where it uses claude.ai's storage. `js/app.js` picks whichever storage is available: claude.ai, then Supabase if configured, then this browser.

## Project structure

```
index.html            Page markup
css/styles.css        Styles, with light and dark themes
js/config.js          Supabase project URL and public key (empty = browser-only mode)
js/cloud.js           Google sign-in, workspaces, team, synced storage and previews via Supabase
js/drive.js           Google Drive picker and photo previews
js/storage.js         Browser storage (local storage with live updates across tabs)
js/app.js             The app: clients, projects, calendar, report, backup, team
supabase/migrations/  Database tables and access rules
docs/                 Setup guides
scripts/serve.mjs     Small static server for `npm start` and the tests
tests/smoke.mjs       End-to-end test of browser-only mode in headless Chromium
tests/cloud.mjs       End-to-end test of sign-in, workspaces, live sync and Drive previews (with fake Supabase and Google)
tests/db/             Access rule tests against a real Postgres database
```

## Testing

```sh
npm install
npx playwright install chromium   # first time only
npm test          # browser tests
npm run test:db   # database access rules; needs Postgres 15+ installed
```

- **Browser-only test:** adds clients, projects and calendar entries, checks that data survives a reload, downloads the timeline report and a backup, restores the backup into a fresh browser, and checks the layout at phone width.
- **Accounts test:** signs in, creates a workspace, copies browser data into it, checks that changes appear live on a second page, manages invites, attaches Drive photos and files, checks previews reach teammates and are deleted with their links, and signs out. Stand-ins for Supabase and Google (`tests/fake-supabase.js`, `tests/fake-google.js`) are used so no real projects are needed.
- **Database test:** applies the migration to a temporary Postgres database and checks the access rules as different people (owners, members, outsiders, invitees, and signed-out visitors), including who can see, add and delete preview images.

GitHub Actions runs all three on every push and pull request.

## Roadmap

Planned for the full version:

- **React + TypeScript rebuild:** split the app into components with unit tests as it grows.
- **More project detail:** budgets, invoices and time tracking, a notes and activity log per client, and deadline reminders.
- **AI assistance:** summarise a client's history, draft follow-up emails, and flag projects that are at risk.
