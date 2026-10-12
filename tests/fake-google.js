// In-browser stand-in for Google Identity Services and the Google Picker,
// for tests/cloud.mjs. Served in place of both Google scripts; picking
// returns window.FAKE_DRIVE_PICKS. Drive downloads are answered by a route
// in the test.
(() => {
  const google = (window.google = window.google || {});
  if (!google.accounts) {
    google.accounts = {
      oauth2: {
        initTokenClient(cfg) {
          return {
            requestAccessToken() {
              window.FAKE_GOOGLE_TOKEN_REQUESTS = (window.FAKE_GOOGLE_TOKEN_REQUESTS || 0) + 1;
              setTimeout(() => cfg.callback({ access_token: 'fake-drive-token', expires_in: 3600 }), 0);
            },
          };
        },
      },
    };
  }
  if (!window.gapi) {
    window.gapi = { load(_name, opts) { setTimeout(() => (typeof opts === 'function' ? opts : opts.callback)(), 0); } };
  }
  if (!google.picker) {
    class DocsView { setIncludeFolders() { return this; } }
    class PickerBuilder {
      addView() { return this; }
      setOAuthToken(t) { this.token = t; return this; }
      setDeveloperKey() { return this; }
      setAppId() { return this; }
      enableFeature() { return this; }
      setMaxItems() { return this; }
      setCallback(cb) { this.cb = cb; return this; }
      build() {
        const cb = this.cb;
        return { setVisible(v) { if (v) setTimeout(() => cb({ action: 'picked', docs: window.FAKE_DRIVE_PICKS || [] }), 0); } };
      }
    }
    google.picker = {
      DocsView, PickerBuilder,
      ViewId: { DOCS: 'all' },
      Feature: { MULTISELECT_ENABLED: 'multi' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType', URL: 'url', SIZE_BYTES: 'sizeBytes' },
    };
  }
})();
