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

## 3. Make the notebook private

Do this immediately after the first deployment.

1. Open the new Worker in Cloudflare.
2. Go to **Settings → Domains & Routes**.
3. Find the `pika-note.<your-account>.workers.dev` route.
4. Open its menu and choose **Enable Cloudflare Access**.
5. Create an Allow policy for your own email address only. Email one-time PIN is convenient on mobile.
6. Make sure the policy covers the whole host (`/*`), including APIs and images.
7. In **Zero Trust → Access controls → Applications**, open the application and copy its **Application Audience (AUD) Tag** from **Additional settings**.
8. Copy your team domain. It looks like `https://your-team-name.cloudflareaccess.com` and appears in the Zero Trust team settings.
9. Return to **Workers & Pages → pika-note → Settings → Variables and Secrets** and add these two text variables:

   | Variable | Value |
   |---|---|
   | `TEAM_DOMAIN` | `https://your-team-name.cloudflareaccess.com` |
   | `POLICY_AUD` | the Application Audience (AUD) Tag you copied |

10. Save the variables, then open the Worker URL. Complete the Cloudflare sign-in and Pika Note will load.

Pika Note shows a locked setup screen until both variables are present and the Access session’s signature, issuer, audience, expiry, and email all pass verification.

## 4. Open it on another device

Open the same `workers.dev` URL on the other phone, tablet, or computer and sign in with the same allowed email. Notes and photos come from the same D1/R2 storage, so they stay in sync.

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

After the `workers.dev` version works, add a custom domain under **Settings → Domains & Routes**. Protect that hostname with the same Cloudflare Access policy. Keep the `workers.dev` route protected too so it cannot bypass your custom-domain policy.
