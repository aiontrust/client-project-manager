// End-to-end test of accounts and sync, with tests/fake-supabase.js standing
// in for Supabase. Covers sign-in, creating a workspace, copying browser data
// into it, live updates between open pages, the Team panel and sign-out.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve.mjs';

const server = await serve(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const fake = await readFile(new URL('./fake-supabase.js', import.meta.url), 'utf8');
const fakeGoogle = await readFile(new URL('./fake-google.js', import.meta.url), 'utf8');
// A 1x1 PNG standing in for a photo downloaded from Drive.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
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

const context = await browser.newContext();
await context.addInitScript(() => {
  window.FAKE_SUPABASE_USER = { id: 'user-olivia', email: 'olivia@example.com', user_metadata: { full_name: 'Olivia Owner' } };
  // Data saved in this browser before signing in, once.
  if (!localStorage.getItem('seeded')) {
    localStorage.setItem('seeded', '1');
    localStorage.setItem('cpm.data.v1', JSON.stringify({
      contacts: { old1: { name: 'Earlier Client', email: '', phone: '', company: 'Old Co', notes: '', createdAt: '2026-01-01T00:00:00Z' } },
      projects: { oldp: { name: 'Earlier Project', clientId: 'old1', startDate: '2026-01-05', endDate: '', status: 'pending', links: [], createdAt: '2026-01-05T00:00:00Z' } },
    }));
  }
});
await context.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, r => r.abort());
await context.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, r => r.fulfill({ contentType: 'text/javascript', body: fake }));
await context.route(/\/js\/config\.js$/, r => r.fulfill({
  contentType: 'text/javascript',
  body: "window.CPM_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test-key', googleClientId: 'cid', googleApiKey: 'key', googleAppId: '123' };",
}));
await context.route(/accounts\.google\.com\/gsi\/client|apis\.google\.com\/js\/api\.js/, r => r.fulfill({ contentType: 'text/javascript', body: fakeGoogle }));
const driveHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' };
await context.route(/www\.googleapis\.com\/drive\/v3\/files\//, r => r.request().method() === 'OPTIONS'
  ? r.fulfill({ status: 204, headers: driveHeaders })
  : r.fulfill({ status: 200, headers: { ...driveHeaders, 'content-type': 'image/png' }, body: PNG }));

async function openApp() {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  return page;
}
const count = (page, id) => page.textContent(`#count-${id}`).then(Number);
const waitCount = (page, id, n) => page.waitForFunction(([id, n]) => document.querySelector(`#count-${id}`).textContent === String(n), [id, n]);

console.log('Client & Project Manager accounts and sync test');
const a = await openApp();

await step('asks signed-out visitors to sign in with Google', async () => {
  await a.waitForSelector('#gate [data-action=sign-in]');
  assert.equal(await a.isVisible('#main-tabs'), false);
  assert.equal(await a.isVisible('#view-clients'), false);
});

await step('signing in leads to creating a workspace', async () => {
  await Promise.all([a.waitForNavigation(), a.click('[data-action=sign-in]')]);
  await a.waitForSelector('#ws-form');
  assert.match(await a.textContent('#gate'), /olivia@example\.com/);
  await a.click('#ws-form [type=submit]');
  assert.match(await a.textContent('#ws-err'), /Enter a name/);
  await a.fill('#ws-name', 'Acme Studio');
  await a.click('#ws-form [type=submit]');
  await a.waitForSelector('#view-clients:not([hidden])');
  assert.equal(await a.textContent('#account-name'), 'Acme Studio');
  assert.match(await a.textContent('#storage-note'), /Acme Studio/);
});

await step('offers to copy data saved in this browser, then copies it', async () => {
  await a.waitForSelector('#import-note:not([hidden])');
  assert.match(await a.textContent('#import-note'), /2 records/);
  assert.equal(await count(a, 'clients'), 0);
  await a.click('[data-action=import-local]');
  await waitCount(a, 'clients', 1);
  await waitCount(a, 'projects', 1);
  assert.equal(await a.isVisible('#import-note'), false);
});

const b = await openApp();
await step('a second page opens straight into the workspace', async () => {
  await waitCount(b, 'clients', 1);
  assert.equal(await b.textContent('#account-name'), 'Acme Studio');
  assert.equal(await b.isVisible('#import-note'), false);
});

await step('changes appear live on the other page', async () => {
  await a.click('#add-contact');
  await a.fill('#f-name', 'Live Client');
  await a.click('#contact-form [type=submit]');
  await waitCount(a, 'clients', 2);
  await waitCount(b, 'clients', 2);
  await a.click('[data-action=new-project-for]');
  await a.fill('#p-name', 'Live Project');
  await a.fill('#p-end', '');
  await a.click('#project-form [type=submit]');
  await waitCount(b, 'projects', 2);
  await b.click('text=Live Client');
  await b.selectOption('#detail select.status', 'completed');
  await a.waitForFunction(() => document.querySelector('#detail .status.completed'));
});

await step('deleting a client removes their projects everywhere', async () => {
  await a.click('[data-action=ask-delete-contact]');
  await a.click('[data-action=delete-contact]');
  await waitCount(b, 'clients', 1);
  await waitCount(b, 'projects', 1);
});

await step('Team panel lists the owner and manages invites', async () => {
  await a.click('#account');
  await a.waitForSelector('#team-members .day-item');
  const team = await a.textContent('#team-members');
  assert.match(team, /Olivia Owner/);
  assert.match(team, /\(you\)/);
  assert.match(team, /Owner/);
  await a.fill('#invite-email', 'mark');
  await a.click('#invite-form [type=submit]');
  assert.match(await a.textContent('#invite-err'), /full email address/);
  await a.fill('#invite-email', 'Mark@Example.com');
  await a.click('#invite-form [type=submit]');
  await a.waitForSelector('#invites-wrap:not([hidden])');
  assert.match(await a.textContent('#team-invites'), /mark@example\.com/);
  await a.click('[data-cancel-invite="mark@example.com"]');
  await a.waitForSelector('#invites-wrap[hidden]', { state: 'attached' });
  await a.click('[data-action=close]');
});

await step('reloading keeps you in the workspace without asking to copy again', async () => {
  await a.reload();
  await waitCount(a, 'clients', 1);
  assert.equal(await a.isVisible('#import-note'), false);
});

await step('timeline report and backup still work in a workspace', async () => {
  await a.click('#tab-calendar');
  await a.click('#open-report');
  await a.waitForSelector('#report-preview svg');
  await a.click('[data-action=close]');
});

const previewCount = page => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fake.supabase.storage') || '{}')).length);
const picks = page => page.evaluate(() => {
  window.FAKE_DRIVE_PICKS = [
    { id: 'img1', name: 'Site photo.png', mimeType: 'image/png', url: 'https://drive.google.com/file/d/img1/view', sizeBytes: 70 },
    { id: 'pdf1', name: 'Contract.pdf', mimeType: 'application/pdf', url: 'https://drive.google.com/file/d/pdf1/view', sizeBytes: 5000 },
  ];
});

await step('attaches Drive photos as previews and other files as links', async () => {
  await picks(a);
  await a.click('#tab-projects');
  await a.click('[data-edit-project="oldp"]');
  await a.click('[data-action=add-drive]:not([disabled])');
  await a.waitForSelector('.link-row.drive-row img[src^="blob:"]');
  assert.equal(await a.locator('.link-row.drive-row').count(), 2);
  assert.match(await a.textContent('.link-row.drive-row:nth-child(2) .row-thumb'), /PDF/);
  await a.click('#project-form [type=submit]');
  // The uploader's page shows the copy it already has; teammates load it from storage (next step).
  await a.waitForSelector('.card .thumbs img[src^="blob:"]');
  assert.equal(await previewCount(a), 1);
  const path = await a.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fake.supabase.storage')))[0]);
  assert.match(path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
});

await step('teammates see the preview on their own screen', async () => {
  await b.click('#tab-projects');
  await b.waitForSelector('.card .thumbs img[src^="data:image/jpeg"]');
});

await step('removing a photo from a project deletes its preview', async () => {
  await a.click('#tab-projects');
  await a.click('[data-edit-project="oldp"]');
  await a.waitForSelector('.link-row.drive-row img[src]');
  await a.click('.link-row.drive-row:has(img) [data-action=remove-link]');
  await a.click('#project-form [type=submit]');
  await a.waitForFunction(() => !document.querySelector('.card .thumbs'));
  assert.equal(await previewCount(a), 0);
  assert.ok(await a.isVisible('.card .link-count'), 'the PDF link is kept');
});

await step('deleting a project deletes its previews', async () => {
  await a.click('[data-edit-project="oldp"]');
  await picks(a);
  await a.click('[data-action=add-drive]');
  await a.waitForSelector('.link-row.drive-row img[src^="blob:"]');
  await a.click('#project-form [type=submit]');
  await a.waitForSelector('.card .thumbs img');
  assert.equal(await previewCount(a), 1);
  await a.click('[data-edit-project="oldp"]');
  await a.click('[data-action=ask-delete-project]');
  await a.click('[data-action=delete-project]');
  await waitCount(a, 'projects', 0);
  assert.equal(await previewCount(a), 0);
});

await step('signing out returns to the sign-in screen', async () => {
  await a.click('#account');
  await Promise.all([a.waitForNavigation(), a.click('.sheet [data-action=sign-out]')]);
  await a.waitForSelector('#gate [data-action=sign-in]');
});

await step('a failed sign-in explains what happened and tidies the address', async () => {
  const p = await openApp();
  await p.evaluate(() => localStorage.removeItem('fake.supabase.session'));
  await p.goto(base + '?from=google#error=server_error&error_description=Unable+to+exchange+external+code');
  await p.waitForSelector('.gate-error');
  assert.match(await p.textContent('.gate-error'), /Unable to exchange external code/);
  assert.equal(new URL(p.url()).hash, '');
  await p.close();
});

await step('signing in from index.html returns to the app folder', async () => {
  const p = await openApp();
  await p.evaluate(() => localStorage.removeItem('fake.supabase.session'));
  await p.goto(base + 'index.html');
  await p.waitForSelector('#gate [data-action=sign-in]');
  await Promise.all([p.waitForNavigation(), p.click('[data-action=sign-in]')]);
  assert.equal(await p.evaluate(() => localStorage.getItem('fake.supabase.lastRedirect')), base);
  await p.close();
});

await step('raises no page errors', async () => {
  assert.deepEqual(errors, [], errors.join(' | '));
});

await browser.close();
server.close();
if (failed) {
  console.log('Some checks failed.');
  process.exit(1);
}
console.log('All checks passed.');
