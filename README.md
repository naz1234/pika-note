# Pika Note

Pika Note is a public, shared notebook for text and photos. Everyone opens the same notebook without an account or login. Notes are stored in Cloudflare D1 and image files stay in a private Cloudflare R2 bucket, served through the public notebook API.

**Anyone with the app link can view, create, edit, archive, and permanently delete notes and photos. Do not store private or sensitive information here.**

## What is included

- Fast text notes with automatic saving
- Photo attachments from a phone camera or photo library
- Search, pin, archive, restore, and permanent delete
- A conflict screen if the same note changes on two devices
- Responsive phone, tablet, and desktop layouts
- Installable PWA icons and a safe offline screen
- Shared notes and photo routes without login; the R2 bucket itself stays private
- GitHub-to-Cloudflare configuration with automatic D1/R2 provisioning

## Deploy from the ZIP

The short version is below. [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md) has the full click-by-click checklist and a manual-storage fallback.

1. Create an empty GitHub repository named `pika-note`.
2. Unzip the package. Upload **the files inside the `pika-note` folder** to the root of the repository, then commit them to `main`.
3. In Cloudflare, open **Workers & Pages → Create application → Import a repository**.
4. Select the GitHub repository and deploy it as a **Worker**, not as a static Pages site. Cross-device storage and uploads require the Worker runtime.
5. Keep the Worker name exactly `pika-note` and use:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: leave blank
6. Open the Worker URL and start using the shared notebook. No Access variables, email allowlist, or sign-in are required.
7. If upgrading an existing private deployment, remove the Cloudflare Access protection for **Pika Note only** as explained below.

## Upgrade an existing private notebook

Deploy the updated `main` branch to the existing Worker with the **same `DB` and `NOTE_IMAGES` bindings**. Existing notes and photos from all former email-owned notebooks become part of the shared notebook. Their IDs, contents, versions, and stored image keys are preserved; no data migration or storage reset is required. New rows use a fixed `shared` owner value for compatibility with the existing database schema. Owner email addresses are not included in API responses.

The app no longer validates Access sessions, but an existing Cloudflare Access rule can still show a login screen before requests reach the Worker. Disable the Pika Note rule in its Cloudflare **Access** settings and remove any Pika Note-specific hostname/path protection in **Zero Trust → Access controls → Applications**. If account-wide protection exists, use a public exception scoped to Pika Note; do not disable protection for other apps. `TEAM_DOMAIN` and `POLICY_AUD` are no longer used and can be removed from this Worker's variables.

After deployment, open the same app URL in a private/incognito window and on another device. Neither should ask for a login, and both should see the same notes and photos. See [Cloudflare's Access controls](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) and [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md).

Cloudflare’s current Wrangler can create the D1 database and R2 bucket automatically because their IDs are intentionally omitted from [`wrangler.jsonc`](./wrangler.jsonc). The app creates its initial tables safely on first use and also includes a generated migration in [`drizzle/`](./drizzle/) for future managed changes.

## Local development (optional)

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Local notes and photos stay in the project-local `.wrangler` folder.

Useful checks:

```bash
npm run types
npm run check
npm test
```

## Shared storage and safeguards

- D1 is the source of truth for notes and attachment metadata. Every visitor uses the same notebook, including existing notes created before public access was enabled.
- R2 stores image bytes. Public API routes serve individual attachments; do not enable public `r2.dev` access for the bucket.
- Edits save automatically. Reloading or returning to the app refreshes the shared notes. A version-conflict screen prevents stale edits from silently overwriting another visitor's changes.
- Mutating requests still require the app's origin. Text is rendered as plain text and uploads are validated by file signature. These checks are not authentication: this app intentionally permits public editing and deletion.
- Accepted image formats: JPEG, PNG, WebP, and GIF. Maximum size: 10 MB each, up to 12 images per note.
- Public visitors can delete content or consume storage. Keep backups and monitor usage; there is no per-user access control.

## Cloudflare references

- [Workers Builds (Git integration)](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Access controls and public exceptions](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

## Project map

- `app/PikaNoteApp.tsx` — mobile interface and sync behavior
- `app/api/` — public shared notes and image endpoints
- `db/` — D1 schema and storage helpers
- `drizzle/` — generated SQL migration
- `worker/` — Cloudflare Worker entry point
- `wrangler.jsonc` — Cloudflare deployment and bindings
- `public/` — PWA icons, offline page, service worker, and social preview
