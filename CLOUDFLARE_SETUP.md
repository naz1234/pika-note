# Pika Note: Cloudflare setup

This checklist assumes you want to upload the ZIP to GitHub yourself and then connect that repository to Cloudflare.

## 1. Upload the project to GitHub

1. Download and unzip the Pika Note package.
2. On GitHub, choose **New repository**.
3. Name it `pika-note` and leave it empty—do not add a README or template.
4. Open the repository and choose **Add file → Upload files**.
5. Drag in everything **inside** the unzipped `pika-note` folder. `package.json` and `wrangler.jsonc` must appear at the repository root, not inside a second nested folder.
6. Commit the files to the `main` branch.

## 2. Import it into Cloudflare

1. Sign in to Cloudflare.
2. Open **Workers & Pages**.
3. Choose **Create application**, then the option to import or connect a Git repository.
4. Connect GitHub if needed and select your `pika-note` repository.
5. Choose a **Worker** deployment. Pika Note is not a static Pages export; its API, database, uploads, and cross-device sync run inside a Worker.
6. Set the Worker name to exactly `pika-note`.
7. Use these build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Root directory | leave blank |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

8. Choose **Save and Deploy**.

Wrangler will provision one D1 binding named `DB` and one private R2 binding named `NOTE_IMAGES`. The first note request creates the initial tables. This may add a little time to the first-ever load only.

## 3. Keep the notebook public

New deployments require no login setup. Anyone with the URL can view and change the same notes and photos, including deleting them permanently. Only store content intended for public sharing.

If upgrading the old private version:

1. Deploy the updated `main` branch to the existing `pika-note` Worker. Keep the original `DB` and `NOTE_IMAGES` bindings so existing data stays available. No database reset or owner migration is needed.
2. In the Worker's **Access** settings, disable the protection for Pika Note. Also check **Zero Trust → Access controls → Applications** for rules protecting this app's `workers.dev` hostname, custom domain, or paths. Remove only the Pika Note-specific protection.
3. If account-wide Worker protection applies, create a public exception for Pika Note following [Cloudflare's guide](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#make-a-worker-public-when-all-workers-are-protected). Keep other Workers protected.
4. The old `TEAM_DOMAIN` and `POLICY_AUD` variables are no longer used and may be removed from Pika Note's settings.
5. Wait for the deployment to finish, then open the app in a private/incognito window. It should open without a login and show the existing shared notes.

Cloudflare Access is configured outside this repository. Merging or deploying this code does not remove an existing edge login rule. If a Cloudflare login screen remains, check all Access rules covering this app; do not disable the `workers.dev` route itself.

## 4. Open it on another device

Open the exact same app URL on another phone, tablet, or computer. No account is needed. Create a test note and add a photo on one device, then reload or return to the app on the second device to see them. Edits, archive/restore, and deletion affect everyone using the notebook. Concurrent stale edits show a conflict choice instead of silently overwriting another saved copy.

On iPhone or Android, use the browser’s **Add to Home Screen** or **Install app** option for an app-like shortcut.

## If automatic storage provisioning is unavailable

Most current Wrangler deployments can create missing resources from binding-only configuration. If your first deploy reports that `DB` or `NOTE_IMAGES` needs an ID/name, create them once in the Cloudflare dashboard:

1. Go to **Storage & Databases → D1** and create `pika-note-db`. Copy its database ID.
2. Go to **Storage & Databases → R2** and create a private bucket named `pika-note-images`. Do not enable `r2.dev` public access.
3. Edit `wrangler.jsonc` in GitHub so the two blocks look like this:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "pika-note-db",
    "database_id": "PASTE-YOUR-D1-DATABASE-ID-HERE",
    "migrations_dir": "drizzle"
  }
],
"r2_buckets": [
  {
    "binding": "NOTE_IMAGES",
    "bucket_name": "pika-note-images"
  }
]
```

4. Commit the edit. Cloudflare will rebuild automatically.

No manual SQL paste is required for the initial version because Pika Note creates missing tables with idempotent `CREATE TABLE IF NOT EXISTS` statements. The committed `drizzle/0000_spotty_roughhouse.sql` migration is provided for future migration-based maintenance.

## Custom domain (optional)

After the `workers.dev` version works, add a custom domain under **Settings → Domains & Routes**. Leave that hostname public as well. Remove any Pika Note-specific Access protection covering it, and verify both URLs in a private/incognito window. Keep the same D1 and R2 bindings; do not make the R2 bucket public.
