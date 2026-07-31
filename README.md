# Pika Note

Pika Note is a private, mobile-first notebook for text and photos. Notes are stored in Cloudflare D1, image files are stored in a private Cloudflare R2 bucket, and the same notebook opens on every device after you sign in through Cloudflare Access.

## What is included

- Fast text notes with automatic saving
- Photo attachments from a phone camera or photo library
- Search, pin, archive, restore, and permanent delete
- A conflict screen if the same note changes on two devices
- Responsive phone, tablet, and desktop layouts
- Installable PWA icons and a safe offline screen
- Private, ownership-checked image routes; the R2 bucket is never public
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
6. After the first deployment, enable **Cloudflare Access** on the `pika-note.<account>.workers.dev` route and allow only your email address.
7. Add two Worker variables so Pika Note can verify Access’s signed session: `TEAM_DOMAIN` and `POLICY_AUD`. The full checklist shows where to copy both values.
8. Open the Worker URL again and sign in. Use the same allowed email on every phone, tablet, or computer.

The app intentionally keeps its data API locked on a public deployment until it cryptographically verifies a Cloudflare Access JWT for your application. Local development on `localhost` is unlocked automatically.

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

## Storage and privacy

- D1 is the source of truth for notes and attachment metadata.
- R2 stores image bytes. Images are served only through authenticated API routes.
- Each Cloudflare Access email has its own notebook. If you allow another email, that person gets a separate empty notebook.
- Mutating requests are same-origin only. Note text is rendered as plain text, and uploads are validated by file signature.
- The API verifies the Access JWT signature, issuer, audience, expiry, and email before using an identity.
- Accepted image formats: JPEG, PNG, WebP, and GIF. Maximum size: 10 MB each, up to 12 images per note.
- Do not enable public `r2.dev` access for the image bucket.

## Cloudflare references

- [Workers Builds (Git integration)](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Protect a workers.dev URL with Access](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#manage-access-to-workersdev)
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

## Project map

- `app/PikaNoteApp.tsx` — mobile interface and sync behavior
- `app/api/` — notes and private image endpoints
- `db/` — D1 schema and storage helpers
- `drizzle/` — generated SQL migration
- `worker/` — Cloudflare Worker entry point
- `wrangler.jsonc` — Cloudflare deployment and bindings
- `public/` — PWA icons, offline page, service worker, and social preview
