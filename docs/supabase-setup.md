# Setting up accounts and sync

This turns on Google sign-in and a shared team workspace. It takes about 20 minutes. You need:

- A free [Supabase](https://supabase.com) account, which stores the data and handles sign-in.
- A [Google Cloud](https://console.cloud.google.com) project, which lets people sign in with Google.

Until these steps are done, the app keeps working as before and saves data in each person's browser.

## 1. Create the Supabase project

1. In Supabase, click **New project**. Pick a name, a strong database password (save it somewhere safe) and the region closest to your team.
2. When the project is ready, open **SQL Editor**, click **New query**, paste the whole of [`supabase/migrations/0001_accounts_and_sync.sql`](../supabase/migrations/0001_accounts_and_sync.sql), and click **Run**. It should finish with "Success. No rows returned".
3. Open **Authentication → Sign In / Providers → Google** and copy the **Callback URL** shown there. It looks like `https://abcdefgh.supabase.co/auth/v1/callback`. Leave this page open; you'll come back to it.

## 2. Set up Google sign-in

1. In Google Cloud Console, create a project (or pick an existing one).
2. Open **Google Auth Platform**, or **APIs & Services → OAuth consent screen** in the older menus. Fill in the app name ("Client & Project Manager") and a support email.
   - **Audience:** choose **Internal** if everyone on your team uses your company's Google Workspace. Only your company's accounts can then sign in. Otherwise choose **External**.
   - With External, the app starts in **Testing** mode, where only the accounts listed under **Test users** can sign in. Add your teammates there, or click **Publish app** when you're ready.
3. Open **Clients** (or **Credentials → Create credentials → OAuth client ID**) and create a **Web application** client:
   - **Authorized JavaScript origins:** `https://aiontrust.github.io` and, for local testing, `http://localhost:8080`
   - **Authorized redirect URIs:** the Supabase Callback URL from step 1.3
4. Copy the **Client ID** and **Client secret**.

## 3. Connect Google to Supabase

1. Back on the Supabase Google provider page, switch Google **on**, paste the Client ID and Client secret, and click **Save**.
2. Open **Authentication → URL Configuration**:
   - **Site URL:** `https://aiontrust.github.io/client-project-manager/`. This must be the app's address, not your Supabase project address: Supabase sends people here whenever a sign-in can't return to the address it started from.
   - **Redirect URLs:** add `https://aiontrust.github.io/client-project-manager/**` and `http://localhost:8080/**`. The `**` covers every page and variation of the app's address, so sign-in returns to the app on any device.

## 4. Point the app at Supabase

1. In Supabase, open **Project Settings → API** (or **Data API** and **API Keys**). Copy the **Project URL** and the **anon public** key.
2. Put them in [`js/config.js`](../js/config.js):

   ```js
   window.CPM_CONFIG = {
     supabaseUrl: 'https://abcdefgh.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...',
   };
   ```

3. Commit and push to `main`. GitHub Pages republishes the app within a minute.

The anon key is designed to be public. It only lets someone ask the database for data; the access rules in the migration decide what each signed-in person can actually see and change. Never put the **service_role** (secret) key in the app.

## 5. Start using it

1. Open the app and click **Sign in with Google**.
2. Name your workspace, usually your company name. You become its **owner**.
3. If you used the app before signing in, it offers to **copy that browser's data into the workspace**. If your data is in another browser, use **Download backup** there, then **Restore from backup** here.
4. Click your workspace name at the top, then **Invite a teammate** with their Google email address. No email is sent, so tell them. They join automatically the first time they sign in with that address.

## Who can do what

| | Owner | Member | Anyone else |
|---|---|---|---|
| See and change clients, projects and calendar | Yes | Yes | No |
| Invite people and cancel invites | Yes | No | No |
| Remove members | Yes | No | No |
| Leave the workspace | No (a workspace always keeps its owner) | Yes | — |

These rules are enforced by the database itself, not just the app. `npm run test:db` checks them against a real Postgres database.

## Troubleshooting

- **"Access blocked" or "redirect_uri_mismatch" from Google:** the redirect URI in Google Cloud must exactly match the Supabase Callback URL.
- **After signing in, a page shows `{"message":"No API key found in request"}` on your `….supabase.co` address:** the Site URL in Supabase is set to the Supabase project address. Set it to the app's address and add the `**` Redirect URLs from step 3.2. It often shows up on only some devices, because each opened the app at a slightly different address.
- **Signed in, but sent back to the wrong address:** check the Site URL and Redirect URLs in Supabase.
- **"Sign-in didn't finish" on the sign-in screen:** the message after it comes from Supabase or Google and names the problem, for example a provider that isn't switched on or a mismatched client secret.
- **A teammate sees "Create your workspace" instead of yours:** they signed in with a different Google account than the one you invited. Invite that address, then have them reload.
- **"Error 403: access_denied":** the Google app is in Testing mode and that person isn't a test user.
