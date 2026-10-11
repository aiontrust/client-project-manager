# Client & Project Manager

A lightweight tool for small businesses and freelancers to keep client contacts, track the projects they run for each client, and plan the work on a calendar.

It runs entirely in the browser: no account, no server, no build step.

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

**Calendar**
- **Month view:** project start and due dates, plus your own calendar entries. Click a day to see everything on it or add an entry.
- **List view:** a spreadsheet-style table (Start · Project · Due · Days left · Links · Client · Status), sortable by any column and grouped by month.
- **Calendar entries:** a title, date, notes, an optional project, and any number of website or Drive links.
- **Timeline report:** a company-review overview of every project across 1–12 months, grouped by client or status. Download it as a PDF or PNG.

**Your data**
- Saved automatically in your browser on the device you use.
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

## Where data is stored

Data lives in the browser's local storage under the key `cpm.data.v1`. It is not sent anywhere. That means:

- Clearing your browser's site data deletes it, so download a backup regularly.
- A different browser or device starts empty until you restore a backup there.

The same app also runs as a page on claude.ai, where it uses claude.ai's storage and syncs across devices automatically. `js/app.js` picks whichever storage is available.

## Project structure

```
index.html            Page markup
css/styles.css        Styles, with light and dark themes
js/storage.js         Browser storage (local storage with live updates across tabs)
js/app.js             The app: clients, projects, calendar, report, backup
scripts/serve.mjs     Small static server for `npm start` and the tests
tests/smoke.mjs       End-to-end test that drives the app in headless Chromium
```

## Testing

```sh
npm install
npx playwright install chromium   # first time only
npm test
```

The smoke test adds clients, projects and calendar entries, checks that data survives a reload, downloads the timeline report and a backup, restores the backup into a fresh browser, and checks the layout at phone width. GitHub Actions runs it on every push and pull request.

## Roadmap

Planned for the full version:

- **Accounts and sync:** a real database and sign-in, so data follows you across devices and a team can share one workspace.
- **Google Drive integration:** pick files from Drive and show image previews instead of plain links.
- **React + TypeScript rebuild:** split the app into components with unit tests as it grows.
- **More project detail:** budgets, invoices and time tracking, a notes and activity log per client, and deadline reminders.
- **AI assistance:** summarise a client's history, draft follow-up emails, and flag projects that are at risk.
