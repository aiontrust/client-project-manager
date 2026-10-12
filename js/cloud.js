// Accounts and sync through Supabase (see supabase/migrations).
// CPMCloud.connect() loads the Supabase library only when the app is
// configured, and returns an account API plus a data store with the same
// interface as js/storage.js: collection(name).onSnapshot(next, error) and
// collection(name).doc(id).set(data) / .delete().
window.CPMCloud = (() => {
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

  // App field -> database column, per collection.
  const FIELDS = {
    contacts: { name: 'name', email: 'email', phone: 'phone', company: 'company', notes: 'notes', example: 'example', createdAt: 'created_at' },
    projects: { name: 'name', clientId: 'client_id', startDate: 'start_date', endDate: 'end_date', status: 'status', links: 'links', example: 'example', createdAt: 'created_at' },
    entries: { title: 'title', date: 'date', projectId: 'project_id', notes: 'notes', links: 'links', example: 'example', createdAt: 'created_at' },
  };
  // Columns the app writes as '' when empty but the database stores as null.
  const BLANK_IS_NULL = new Set(['start_date', 'end_date', 'date', 'project_id']);

  function toRow(col, workspaceId, id, data) {
    const row = { workspace_id: workspaceId, id };
    for (const [field, column] of Object.entries(FIELDS[col])) {
      if (!(field in data)) continue;
      const v = data[field];
      row[column] = BLANK_IS_NULL.has(column) && v === '' ? null : v;
    }
    return row;
  }

  function fromRow(col, row) {
    const out = {};
    for (const [field, column] of Object.entries(FIELDS[col])) {
      const v = row[column];
      if (v === null || v === undefined) {
        if (BLANK_IS_NULL.has(column)) out[field] = '';
        continue;
      }
      out[field] = v;
    }
    if (!out.example) delete out.example;
    return out;
  }

  // Postgres "insufficient privilege" means this person can no longer change
  // the workspace; the app shows it read-only. Anything else is a failed save.
  function toStoreError(error) {
    if (error && error.code === '42501') return { code: 'invalid_argument', message: error.message };
    return { code: 'unavailable', message: (error && error.message) || 'Request failed' };
  }

  function loadLibrary() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => (window.supabase ? resolve(window.supabase) : reject(new Error('Supabase library missing')));
      s.onerror = () => reject(new Error('The sign-in service didn’t load. Check your connection and reload the page.'));
      document.head.appendChild(s);
    });
  }

  function createStore(client, workspaceId) {
    const cache = {};
    const listeners = {};
    const timers = {};
    const loaded = {};

    const snapshot = col => {
      const docs = [...(cache[col] || new Map()).values()].map(row => ({ id: row.id, exists: true, data: () => fromRow(col, row) }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    };
    const emit = col => (listeners[col] || []).forEach(l => l.next(snapshot(col)));

    async function refresh(col) {
      const { data, error } = await client.from(col).select('*').eq('workspace_id', workspaceId);
      if (error) {
        // The first load failing is fatal for the page; later blips wait for the next change.
        if (!loaded[col]) (listeners[col] || []).forEach(l => l.error && l.error(toStoreError(error)));
        return;
      }
      cache[col] = new Map(data.map(row => [row.id, row]));
      loaded[col] = true;
      emit(col);
    }
    const schedule = col => {
      clearTimeout(timers[col]);
      timers[col] = setTimeout(() => refresh(col), 200);
    };

    // Any change by anyone in the workspace triggers a re-read of that table.
    // Row level security limits what each person receives.
    const channel = client.channel(`workspace-${workspaceId}`);
    for (const col of Object.keys(FIELDS)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: col }, () => schedule(col));
    }
    channel.subscribe(status => {
      // After a reconnect, catch up on anything missed while offline.
      if (status === 'SUBSCRIBED') Object.keys(listeners).forEach(col => loaded[col] && schedule(col));
    });

    return {
      collection(col) {
        if (!FIELDS[col]) throw new TypeError(`Unknown collection ${col}`);
        return {
          onSnapshot(next, error) {
            const l = { next, error };
            (listeners[col] ||= new Set()).add(l);
            if (loaded[col]) setTimeout(() => next(snapshot(col)), 0);
            else refresh(col);
            return () => listeners[col].delete(l);
          },
          doc(id) {
            return {
              async set(data) {
                const row = toRow(col, workspaceId, id, data);
                const { error } = await client.from(col).upsert(row, { onConflict: 'workspace_id,id' });
                if (error) throw toStoreError(error);
                // Show the change right away; the live update confirms it.
                (cache[col] ||= new Map()).set(id, { ...(cache[col].get(id) || {}), ...row });
                emit(col);
                schedule(col);
              },
              async delete() {
                const { error } = await client.from(col).delete().eq('workspace_id', workspaceId).eq('id', id);
                if (error) throw toStoreError(error);
                cache[col]?.delete(id);
                emit(col);
                // Deletes cascade (a client's projects, a project's entry links).
                Object.keys(FIELDS).forEach(schedule);
              },
            };
          },
        };
      },
      close() { client.removeChannel(channel); },
    };
  }

  async function connect(config) {
    if (!config || !config.supabaseUrl || !config.supabaseAnonKey) return null;
    const lib = await loadLibrary();
    const client = lib.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const fail = error => { if (error) throw new Error(error.message || 'Request failed'); };

    const account = {
      async user() {
        const { data, error } = await client.auth.getSession();
        fail(error);
        const u = data.session && data.session.user;
        if (!u) return null;
        const meta = u.user_metadata || {};
        return { id: u.id, email: u.email, name: meta.full_name || meta.name || '' };
      },
      async signIn() {
        // Always return to the app's folder address, so opening the app as
        // ".../index.html" still matches the redirect URL allowed in Supabase.
        const redirectTo = location.origin + location.pathname.replace(/\/[^/]*\.html?$/, '/');
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
        fail(error);
      },
      async signOut() {
        await client.auth.signOut();
      },
      onSignedOut(fn) {
        client.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') fn(); });
      },
      async workspaces() {
        const accepted = await client.rpc('accept_invites');
        fail(accepted.error);
        const { data, error } = await client.rpc('my_workspaces');
        fail(error);
        return data;
      },
      async createWorkspace(name) {
        const { data, error } = await client.rpc('create_workspace', { ws_name: name });
        fail(error);
        return data;
      },
      async members(workspaceId) {
        const { data, error } = await client.from('workspace_members').select('user_id,email,name,role,joined_at').eq('workspace_id', workspaceId);
        fail(error);
        return data;
      },
      async invites(workspaceId) {
        const { data, error } = await client.from('workspace_invites').select('email,created_at').eq('workspace_id', workspaceId);
        fail(error);
        return data;
      },
      async invite(workspaceId, email) {
        const { error } = await client.from('workspace_invites').insert({ workspace_id: workspaceId, email: email.trim().toLowerCase() });
        if (error && error.code === '23505') return;
        fail(error);
      },
      async cancelInvite(workspaceId, email) {
        const { error } = await client.from('workspace_invites').delete().eq('workspace_id', workspaceId).eq('email', email);
        fail(error);
      },
      async removeMember(workspaceId, userId) {
        const { error } = await client.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
        fail(error);
      },
      store(workspaceId) {
        return createStore(client, workspaceId);
      },
      // Preview images of Drive photos (see supabase/migrations/0002).
      async uploadPreview(workspaceId, blob) {
        const path = `${workspaceId}/${crypto.randomUUID()}.jpg`;
        const { error } = await client.storage.from('previews').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        fail(error);
        return path;
      },
      async previewUrls(paths) {
        const { data, error } = await client.storage.from('previews').createSignedUrls(paths, 3600);
        fail(error);
        const out = {};
        for (const d of data || []) if (d.signedUrl && !d.error) out[d.path] = d.signedUrl;
        return out;
      },
      async removePreviews(paths) {
        if (!paths.length) return;
        const { error } = await client.storage.from('previews').remove(paths);
        fail(error);
      },
    };
    return account;
  }

  return { connect, toRow, fromRow };
})();
