# Setting up Google Drive previews

This adds an **+ Add from Drive** button to project and calendar-entry forms. People pick files from their Google Drive. Photos get a small preview that everyone in the workspace can see, and other files (PDFs, Docs, videos) are attached as links. It takes about 10 minutes and builds on [accounts and sync](supabase-setup.md), which must be working first.

## How it works, and what it can access

- The app asks Google for the **drive.file** permission. It only covers files a person picks in the Drive picker. The app can never see or change the rest of anyone's Drive.
- The first time each person clicks **Add from Drive**, Google asks them to allow this.
- For each picked photo, the app downloads it once in that person's browser and saves a **small JPEG preview** (up to 640 pixels, usually 30–100 KB) in your Supabase project's private `previews` storage. Only members of the workspace can see it. The original stays in Drive, and tapping a preview opens it there.
- Removing a photo from a project or entry, or deleting the project or entry, deletes its preview.
- Teammates see the preview even if the Drive file isn't shared with them. To open the full file, they still need access to it in Drive.

## 1. Google Cloud

Use the same Google Cloud project you set up for sign-in.

1. Open **APIs & Services → Library**. Find and **Enable** both **Google Drive API** and **Google Picker API**.
2. Open **Google Auth Platform → Data access** (or **OAuth consent screen → Scopes**). Click **Add or remove scopes** and add `https://www.googleapis.com/auth/drive.file`. Google lists it as "See, edit, create, and delete only the specific Google Drive files you use with this app". It doesn't need Google's app verification. Click **Save**.
3. Open **Clients** (or **Credentials**) and open the **Web application** client you made for sign-in. Check that **Authorized JavaScript origins** includes `https://aiontrust.github.io` (and `http://localhost:8080` for local testing). Copy the **Client ID**.
4. Open **Credentials → Create credentials → API key**. Then edit the key:
   - **Application restrictions:** Websites, with `https://aiontrust.github.io/*` and `http://localhost:8080/*`.
   - **API restrictions:** Restrict key → **Google Picker API**.
   - Copy the key.
5. Find the **Project number**: it's on the project's **Dashboard**, or in **IAM & Admin → Settings**. It's all digits. This is the app ID the picker needs.

## 2. Supabase

1. Open **SQL Editor → New query**, paste the whole of [`supabase/migrations/0002_drive_previews.sql`](../supabase/migrations/0002_drive_previews.sql), and click **Run**.
2. Open **Storage**. A private bucket named `previews` should be listed.

## 3. The app

Add the three values to [`js/config.js`](../js/config.js), next to your Supabase settings:

```js
  googleClientId: '1234567890-abc.apps.googleusercontent.com',
  googleApiKey: 'AIza...',
  googleAppId: '1234567890',
```

Commit and push to `main`. After GitHub Pages republishes, project and entry forms show **+ Add from Drive**.

These values are public by design. The client ID only works on the websites listed in step 1.3, and the API key only works on the websites in step 1.4.

## Troubleshooting

- **The button stays on "Loading Drive…" or says "Drive unavailable":** Google's scripts didn't load. Check the connection and any content blockers, then reopen the form.
- **Nothing happens when clicking Add from Drive:** the browser blocked Google's permission pop-up. Allow pop-ups for the site and try again.
- **"Error 400: redirect_uri_mismatch" or "origin_mismatch":** the app's address isn't in the client's **Authorized JavaScript origins** (step 1.3).
- **The picker says "The API developer key is invalid":** the API key isn't allowed on this website, or isn't allowed to use the Google Picker API (step 1.4).
- **"Access blocked: this app's request is invalid" or a missing-scope error:** add the `drive.file` scope (step 1.2). In Testing mode, the person also needs to be a test user.
- **A photo attaches as a link without a preview:** the browser couldn't read that image format. iPhone HEIC photos, for example, can only be read in Safari. The link still opens the photo in Drive.
- **On phones:** Google's picker is designed for larger screens. It works on phones but can feel cramped. Pasting a Drive link still works everywhere, without a preview.
