// In-browser stand-in for the parts of supabase-js the app uses, for
// tests/cloud.mjs. Data lives in localStorage so it survives reloads and is
// shared by pages in the same browser context; writes are broadcast to other
// pages to mimic Supabase live updates. Access rules are tested separately
// against real Postgres in tests/db.
(() => {
  const DB_KEY = 'fake.supabase.db';
  const SESSION_KEY = 'fake.supabase.session';
  const bus = new BroadcastChannel('fake.supabase.realtime');

  const readDb = () => JSON.parse(localStorage.getItem(DB_KEY) || 'null') || {
    workspaces: [], workspace_members: [], workspace_invites: [], contacts: [], projects: [], entries: [],
  };
  const writeDb = db => localStorage.setItem(DB_KEY, JSON.stringify(db));
  const session = () => JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  const me = () => session()?.user;

  function createClient() {
    const handlers = [];
    const notify = table => {
      handlers.filter(h => h.table === table).forEach(h => setTimeout(() => h.fn({ table }), 0));
    };
    bus.onmessage = e => notify(e.data.table);
    const changed = table => { notify(table); bus.postMessage({ table }); };

    class Query {
      constructor(table) { this.table = table; this.filters = []; this.op = 'select'; }
      select() { return this; }
      eq(col, val) { this.filters.push([col, val]); return this; }
      insert(row) { this.op = 'insert'; this.row = row; return this; }
      upsert(row, opts) { this.op = 'upsert'; this.row = row; this.keys = opts.onConflict.split(','); return this; }
      delete() { this.op = 'delete'; return this; }
      matches(r) { return this.filters.every(([c, v]) => r[c] === v); }
      run() {
        if (!me()) return { data: null, error: { code: '42501', message: 'Not signed in' } };
        const db = readDb();
        const rows = db[this.table];
        if (this.op === 'select') return { data: rows.filter(r => this.matches(r)), error: null };
        if (this.op === 'insert') {
          if (this.table === 'workspace_invites' && rows.some(r => r.workspace_id === this.row.workspace_id && r.email === this.row.email)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          rows.push({ ...this.row, created_at: new Date().toISOString() });
        } else if (this.op === 'upsert') {
          const i = rows.findIndex(r => this.keys.every(k => r[k] === this.row[k]));
          if (i >= 0) rows[i] = { ...rows[i], ...this.row }; else rows.push({ ...this.row });
        } else if (this.op === 'delete') {
          db[this.table] = rows.filter(r => !this.matches(r));
        }
        writeDb(db);
        changed(this.table);
        return { data: null, error: null };
      }
      then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
    }

    const rpcs = {
      accept_invites() {
        const db = readDb(), u = me();
        const mine = db.workspace_invites.filter(i => i.email === u.email);
        for (const i of mine) {
          if (!db.workspace_members.some(m => m.workspace_id === i.workspace_id && m.user_id === u.id)) {
            db.workspace_members.push({ workspace_id: i.workspace_id, user_id: u.id, role: 'member', email: u.email, name: u.user_metadata.full_name, joined_at: new Date().toISOString() });
          }
        }
        db.workspace_invites = db.workspace_invites.filter(i => i.email !== u.email);
        writeDb(db);
        return mine.length;
      },
      my_workspaces() {
        const db = readDb(), u = me();
        return db.workspace_members.filter(m => m.user_id === u.id)
          .map(m => ({ id: m.workspace_id, name: db.workspaces.find(w => w.id === m.workspace_id).name, role: m.role }));
      },
      create_workspace({ ws_name }) {
        const db = readDb(), u = me(), id = crypto.randomUUID();
        db.workspaces.push({ id, name: ws_name.trim() });
        db.workspace_members.push({ workspace_id: id, user_id: u.id, role: 'owner', email: u.email, name: u.user_metadata.full_name, joined_at: new Date().toISOString() });
        writeDb(db);
        return id;
      },
    };

    return {
      from: table => new Query(table),
      async rpc(name, args) {
        if (!me()) return { data: null, error: { code: '42501', message: 'Not signed in' } };
        return { data: rpcs[name](args || {}), error: null };
      },
      channel() {
        return {
          on(_type, filter, fn) { handlers.push({ table: filter.table, fn }); return this; },
          subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 0); return this; },
        };
      },
      removeChannel() { handlers.length = 0; },
      auth: {
        async getSession() { return { data: { session: session() }, error: null }; },
        async signInWithOAuth({ provider, options }) {
          if (provider !== 'google') return { error: { message: 'Only Google sign-in is set up' } };
          localStorage.setItem(SESSION_KEY, JSON.stringify({ user: window.FAKE_SUPABASE_USER }));
          localStorage.setItem('fake.supabase.lastRedirect', options.redirectTo);
          setTimeout(() => location.assign(options.redirectTo), 0);
          return { error: null };
        },
        async signOut() { localStorage.removeItem(SESSION_KEY); return { error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      },
    };
  }

  window.supabase = { createClient };
})();
