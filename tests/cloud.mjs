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
  body: "window.CPM_CONFIG = { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test-key' };",
}));

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
