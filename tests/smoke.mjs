// End-to-end smoke test: drives the app in headless Chromium against the local server.
// Run with `npm test`. Set CHROMIUM_PATH to use an already-installed Chromium.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve.mjs';

const server = await serve(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let failed = false;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed = true;
    console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`);
  }
}

async function openApp(context, width = 1280) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  // Fonts and the PDF library come from CDNs; keep the test offline and fast.
  await page.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, r => r.abort());
  // Browser-only mode: switch accounts off whatever js/config.js says.
  await page.route(/\/js\/config\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: "window.CPM_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };" }));
  await page.goto(base);
  return page;
}
const count = (page, id) => page.textContent(`#count-${id}`).then(Number);

console.log('Client & Project Manager smoke test');
const context = await browser.newContext({ acceptDownloads: true });
const page = await openApp(context);

await step('starts empty and offers example data', async () => {
  assert.equal(await count(page, 'clients'), 0);
  await page.click('[data-action=load-examples]');
  await page.waitForFunction(() => document.querySelector('#count-projects').textContent === '5');
  assert.equal(await count(page, 'clients'), 3);
});

await step('adds a client', async () => {
  await page.click('#add-contact');
  await page.fill('#f-name', 'Test Client');
  await page.fill('#f-email', 'not-an-email');
  await page.click('#contact-form [type=submit]');
  assert.match(await page.textContent('#f-err'), /email address/);
  await page.fill('#f-email', 'test@example.com');
  await page.click('#contact-form [type=submit]');
  await page.waitForFunction(() => document.querySelector('#count-clients').textContent === '4');
});

await step('adds a project with a Drive link and rejects a bad date range', async () => {
  await page.click('[data-action=new-project-for]');
  await page.fill('#p-name', 'Test Project');
  await page.fill('#p-start', '2026-10-10');
  await page.fill('#p-end', '2026-10-01');
  await page.click('[data-action=add-link]');
  await page.fill('.link-row [name=link-url]', 'drive.google.com/file/d/abc');
  await page.click('#project-form [type=submit]');
  assert.match(await page.textContent('#p-err'), /due date is before/);
  await page.fill('#p-end', '2026-10-20');
  await page.click('#project-form [type=submit]');
  await page.waitForFunction(() => document.querySelector('#count-projects').textContent === '6');
  // The link opens straight from the client's project list, in a new tab.
  const chip = page.locator('#detail .link-chip');
  assert.equal(await chip.count(), 1);
  assert.equal(await chip.getAttribute('href'), 'https://drive.google.com/file/d/abc');
  assert.equal(await chip.getAttribute('target'), '_blank');
  assert.match(await chip.textContent(), /Drive/);
});

await step('changes a project status from the client page', async () => {
  await page.selectOption('#detail select.status', 'completed');
  await page.waitForSelector('#detail .status.completed');
});

await step('keeps data after a reload', async () => {
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#count-clients').textContent === '4');
  assert.equal(await count(page, 'projects'), 6);
});

await step('a project card folds several links into a dropdown', async () => {
  const card = '#board .card:has-text("Test Project")';
  await page.click('#tab-projects');
  await page.click(`${card} [data-edit-project]`);
  await page.click('[data-action=add-link]');
  await page.locator('.link-row').nth(1).locator('[name=link-label]').fill('Client brief');
  await page.locator('.link-row').nth(1).locator('[name=link-url]').fill('https://example.com/brief');
  await page.click('[data-action=add-link]');
  await page.locator('.link-row').nth(2).locator('[name=link-url]').fill('https://drive.google.com/drive/folders/xyz');
  await page.click('#project-form [type=submit]');
  await page.waitForSelector(`${card} .link-menu summary`);
  assert.match(await page.textContent(`${card} .link-menu summary`), /Links\s*3/);
  assert.equal(await page.isVisible(`${card} .link-menu a`), false, 'closed until clicked');
  await page.click(`${card} .link-menu summary`);
  const links = page.locator(`${card} .link-menu a`);
  assert.equal(await links.count(), 3);
  assert.equal(await links.nth(1).getAttribute('href'), 'https://example.com/brief');
  assert.equal(await links.nth(1).getAttribute('target'), '_blank');
  await page.click('#summary');
  assert.equal(await page.isVisible(`${card} .link-menu a`), false, 'clicking elsewhere closes it');
  // Back to one link for the checks that follow.
  await page.click(`${card} [data-edit-project]`);
  await page.locator('.link-row').nth(2).locator('[data-action=remove-link]').click();
  await page.locator('.link-row').nth(1).locator('[data-action=remove-link]').click();
  await page.click('#project-form [type=submit]');
  await page.waitForSelector(`${card} .link-chip`);
});

await step('shows the calendar month and list views', async () => {
  await page.click('#tab-calendar');
  await page.click('[data-calmode=month]');
  assert.ok((await page.locator('.day').count()) >= 28);
  await page.click('[data-calmode=list]');
  const headers = await page.locator('.listview th').allTextContents();
  assert.deepEqual(headers.map(h => h.replace(/[↑↓]/g, '').trim()), ['Start', 'Project', 'Due', 'Days left', 'Links', 'Client', 'Status']);
  assert.ok(await page.locator('.listview .link-chip[href="https://drive.google.com/file/d/abc"]').count() === 1, 'list links are clickable');
  await page.click('#tab-projects');
  assert.ok(await page.locator('.card .link-chip[href="https://drive.google.com/file/d/abc"]').count() === 1, 'project card links are clickable');
  await page.click('#tab-calendar');
});

await step('adds a calendar entry from a day', async () => {
  await page.click('[data-calmode=month]');
  await page.click('.day.today');
  await page.click('[data-action=new-entry]');
  await page.fill('#e-title', 'Photo review');
  await page.fill('.link-row [name=link-url]', 'https://drive.google.com/drive/folders/xyz');
  await page.click('#entry-form [type=submit]');
  await page.waitForSelector('.day.today .evt.entry');
});

await step('downloads the timeline report as PNG', async () => {
  await page.click('#open-report');
  await page.waitForSelector('#report-preview svg');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export-png]')]);
  assert.match(dl.suggestedFilename(), /^project-timeline-.*\.png$/);
  const bytes = await readFile(await dl.path());
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  await page.click('[data-action=close]');
});

let backupPath;
await step('downloads a backup', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backup-download')]);
  backupPath = await dl.path();
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.contacts.length, 4);
  assert.equal(backup.projects.length, 6);
  assert.equal(backup.entries.length, 3);
});

await step('restores the backup into a fresh browser', async () => {
  const fresh = await browser.newContext();
  const p2 = await openApp(fresh);
  assert.equal(await count(p2, 'clients'), 0);
  await p2.setInputFiles('#backup-file', backupPath);
  await p2.waitForFunction(() => document.querySelector('#count-clients').textContent === '4');
  assert.equal(await count(p2, 'projects'), 6);
  await fresh.close();
});

await step('fits a phone screen without sideways scrolling', async () => {
  const phone = await openApp(context, 400);
  for (const tab of ['clients', 'projects', 'calendar']) {
    await phone.click(`#tab-${tab}`);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 400, `${tab} is ${w}px wide`);
  }
});

await step('shows one empty-state message on a phone', async () => {
  const fresh = await browser.newContext();
  const p = await openApp(fresh, 400);
  await p.waitForSelector('#detail .empty');
  const visible = await p.$$eval('.empty strong', els => els.filter(e => e.offsetParent).map(e => e.textContent));
  assert.deepEqual(visible, ['Your client book is empty']);
  assert.ok(await p.isVisible('[data-action=load-examples]'));
  await p.click('[data-action=load-examples]');
  await p.waitForFunction(() => document.querySelector('#count-clients').textContent === '3');
  await p.reload();
  await p.waitForFunction(() => document.querySelector('#count-clients').textContent === '3');
  assert.equal(await p.isVisible('#detail'), false, 'Pick a client card is hidden');
  await p.click('[data-select="ex-c2"]');
  assert.ok(await p.isVisible('#detail h2'));
  const wide = await openApp(fresh, 1280);
  await wide.waitForFunction(() => document.querySelector('#count-clients').textContent === '3');
  assert.ok(await wide.isVisible('text=Pick a client'), 'desktop keeps the Pick a client card');
  await fresh.close();
});

await step('raises no page errors', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
server.close();
if (failed) {
  console.log('Some checks failed.');
  process.exit(1);
}
console.log('All checks passed.');
