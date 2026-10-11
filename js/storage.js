// Browser storage for running the app on its own (outside claude.ai).
// Exposes the same small surface the app uses from the claude.ai `db`
// capability: collection(name).onSnapshot(cb) and collection(name).doc(id).set/delete.
window.CPMLocalStore = (() => {
  const KEY = 'cpm.data.v1';

  function open() {
    let ls;
    try {
      ls = window.localStorage;
      ls.setItem('cpm.probe', '1');
      ls.removeItem('cpm.probe');
    } catch {
      return null;
    }

    const listeners = new Map();
    const read = () => {
      try {
        const d = JSON.parse(ls.getItem(KEY) || '{}');
        return d && typeof d === 'object' ? d : {};
      } catch {
        return {};
      }
    };
    const write = d => {
      try {
        ls.setItem(KEY, JSON.stringify(d));
      } catch (e) {
        throw { code: 'quota_exceeded', message: String(e) };
      }
    };
    const snapshot = col => {
      const docs = Object.entries(read()[col] || {}).map(([id, data]) => ({ id, exists: true, data: () => data }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    };
    const emit = col => (listeners.get(col) || []).forEach(cb => cb(snapshot(col)));

    // Keep other open tabs in step.
    window.addEventListener('storage', e => {
      if (e.key === KEY) listeners.forEach((_, col) => emit(col));
    });

    return {
      collection(col) {
        return {
          onSnapshot(next) {
            if (!listeners.has(col)) listeners.set(col, new Set());
            listeners.get(col).add(next);
            setTimeout(() => next(snapshot(col)), 0);
            return () => listeners.get(col).delete(next);
          },
          doc(id) {
            return {
              async set(data) {
                const d = read();
                (d[col] ||= {})[id] = JSON.parse(JSON.stringify(data));
                write(d);
                emit(col);
              },
              async delete() {
                const d = read();
                if (d[col]) delete d[col][id];
                write(d);
                emit(col);
              },
            };
          },
        };
      },
    };
  }

  return { open };
})();
