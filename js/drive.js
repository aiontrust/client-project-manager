// Google Drive: pick files with the Google Picker and make small JPEG
// previews of picked photos. Uses the drive.file permission, which only
// covers files the person picks here, never the rest of their Drive.
//
// Browsers only open Google's permission popup straight from a click, so
// call prepare() when a form with a Drive button opens, and pick() from
// the click itself.
window.CPMDrive = (() => {
  const GSI = 'https://accounts.google.com/gsi/client';
  const GAPI = 'https://apis.google.com/js/api.js';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const PREVIEW_SIZE = 640;
  const MAX_DOWNLOAD = 30 * 1024 * 1024;

  let config = null;
  let readyPromise = null;
  let ready = false;
  let tokenClient = null;
  let token = null;
  let tokenExpires = 0;
  let pendingToken = null;

  const configured = cfg => !!(cfg && cfg.googleClientId && cfg.googleApiKey && cfg.googleAppId);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Google Drive didn’t load. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }

  // Load Google's scripts and set up the permission request ahead of the click.
  function prepare(cfg, loginHint) {
    if (!configured(cfg)) return Promise.resolve(false);
    config = cfg;
    readyPromise ||= Promise.all([loadScript(GSI), loadScript(GAPI)])
      .then(() => new Promise((resolve, reject) => {
        window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('The Google file picker didn’t load.')) });
      }))
      .then(() => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId,
          scope: SCOPE,
          hint: loginHint || undefined,
          callback: resp => {
            const p = pendingToken; pendingToken = null;
            if (!p) return;
            if (resp.error || !resp.access_token) { p.reject(new Error(resp.error_description || 'Google didn’t grant access to Drive.')); return; }
            token = resp.access_token;
            tokenExpires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
            p.resolve(token);
          },
          error_callback: err => {
            const p = pendingToken; pendingToken = null;
            if (p) p.reject(new Error(err && err.type === 'popup_closed' ? 'cancelled' : 'Google sign-in for Drive didn’t open. Allow pop-ups for this site and try again.'));
          },
        });
        ready = true;
        return true;
      })
      .catch(e => { readyPromise = null; throw e; });
    return readyPromise;
  }

  function accessToken() {
    if (token && Date.now() < tokenExpires - 60000) return Promise.resolve(token);
    return new Promise((resolve, reject) => {
      pendingToken = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  // Opens the picker. Resolves to the picked files ([] when cancelled).
  function pick() {
    if (!ready) return Promise.reject(new Error('Google Drive is still loading. Try again in a moment.'));
    return accessToken().then(tok => new Promise(resolve => {
      const P = window.google.picker;
      const view = new P.DocsView(P.ViewId.DOCS).setIncludeFolders(false);
      new P.PickerBuilder()
        .addView(view)
        .setOAuthToken(tok)
        .setDeveloperKey(config.googleApiKey)
        .setAppId(config.googleAppId)
        .enableFeature(P.Feature.MULTISELECT_ENABLED)
        .setMaxItems(10)
        .setCallback(data => {
          const action = data[P.Response.ACTION];
          if (action === P.Action.CANCEL) resolve([]);
          if (action !== P.Action.PICKED) return;
          resolve((data[P.Response.DOCUMENTS] || []).map(d => ({
            id: d[P.Document.ID],
            name: d[P.Document.NAME] || 'Drive file',
            mimeType: d[P.Document.MIME_TYPE] || '',
            url: d[P.Document.URL] || `https://drive.google.com/file/d/${d[P.Document.ID]}/view`,
            sizeBytes: Number(d[P.Document.SIZE_BYTES]) || 0,
          })));
        })
        .build()
        .setVisible(true);
    })).catch(e => {
      if (e.message === 'cancelled') return [];
      throw e;
    });
  }

  function decode(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => decodeWithImg(blob));
    }
    return decodeWithImg(blob);
  }
  function decodeWithImg(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // A small JPEG of a picked photo, or null for other files and photos the
  // browser can't read.
  async function preview(file) {
    if (!/^image\//.test(file.mimeType) || file.sizeBytes > MAX_DOWNLOAD) return null;
    try {
      const tok = await accessToken();
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${tok}` } });
      if (!res.ok) return null;
      const image = await decode(await res.blob());
      const w = image.width, h = image.height;
      const scale = Math.min(1, PREVIEW_SIZE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (image.close) image.close();
      return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    } catch {
      return null;
    }
  }

  return { configured, prepare, pick, preview, isReady: () => ready };
})();
