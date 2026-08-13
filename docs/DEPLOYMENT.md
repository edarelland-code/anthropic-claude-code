# ContextShelf — Setup and Deployment

Goal: **one HTTPS URL you open from the Mac, the Windows PC, and a phone**, backed by one cloud
database. Local development is for building ContextShelf, not for using it.

Steps marked **[you]** need an account only you can create. Everything else is already done or is
a single command.

---

## What you need to do (the short version)

| # | Action | Why | Time |
|---|---|---|---|
| 1 | Create a Supabase project | The cloud database and auth service. Cannot be created without your account. | 3 min |
| 2 | Put its URL + publishable key in `.env.local` | Connects the app to it | 1 min |
| 3 | `npx supabase login && npx supabase link && npm run db:push` | Applies the schema | 2 min |
| 4 | Import the repo into Vercel and paste the same two variables | Gives you the shared URL | 5 min |
| 5 | Add the Vercel URL to Supabase's redirect allow-list | Otherwise sign-in links bounce | 1 min |
| 6 | (Recommended) Change the email template to the OTP form in §6 | Lets a link requested on one device be opened on another | 1 min |

After step 4 you have the cross-device URL. Steps 5–6 make sign-in work reliably from it.

---

## 1. Create the Supabase project **[you]**

1. <https://supabase.com/dashboard> → **New project**
2. Name `contextshelf`. Pick the region closest to you. Save the database password somewhere safe —
   the app does not use it, but you will need it if you ever connect with `psql`.
3. Wait for provisioning (~2 min).
4. **Project Settings → API Keys** and copy:
   - **Project URL** (Settings → API) → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key**, `sb_publishable_…` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

The publishable key is Supabase's current browser-facing key and replaces the legacy anon JWT. It
is designed to ship to browsers: RLS is what protects the data, and
`supabase/tests/02_rls.test.sql` proves it does. **The secret key (`sb_secret_…`) is different** —
it bypasses RLS entirely. ContextShelf does not use it yet; when Phase 5 adds `/api/ingest` it
will live in `SUPABASE_SECRET_KEY`, server-side only, never behind a `NEXT_PUBLIC_` prefix.

If your project predates the new key format and still shows only an anon JWT, generate the new
pair from the same screen. ContextShelf reads only
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; if the legacy variable is set instead, the `/setup`
screen says so by name rather than failing silently.

Note the naming split: the Postgres **roles** are still `anon`, `authenticated`, and
`service_role`, and the migration grants against those names. Only the API key names changed.

## 2. Configure locally

```bash
cp .env.example .env.local
# paste the two values
```

`.env.local` is gitignored. No secret is ever committed.

## 3. Apply the schema

```bash
npx supabase login                       # [you] opens a browser once
npx supabase link --project-ref <ref>    # the ref is in your project URL
npm run db:push
```

Then confirm it actually landed — the migration file being correct is not the same as the
database being correct:

```bash
npx supabase db diff --linked      # should report no differences
```

The migration creates 24 tables, the enums, the indexes, the RLS policies, the append-only
guarantees, and the trigger that gives each new user a workspace.

**Never change the schema from the dashboard SQL editor.** Add a migration file instead, or the
next `db push` silently reverts your change.

## 4. Deploy **[you]**

**Vercel**, because it is the reference host for Next.js: zero-config App Router support, Server
Actions and middleware work as written, HTTPS and preview deploys are automatic, and the free tier
covers a single-user app. (Netlify and Cloudflare both work too but need adapter configuration
that buys nothing here.)

1. <https://vercel.com/new> → import `edarelland-code/anthropic-claude-code`
2. Framework preset **Next.js** (auto-detected). Root directory `./`.
3. **Environment Variables** — add to *Production*, *Preview*, and *Development*:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | your publishable key (`sb_publishable_…`) |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app` |
4. Set the **Production Branch** to `main`.
5. Deploy. Note the URL — that is the ContextShelf URL you open everywhere.

## 5. Point Supabase at that URL **[you]**

**Authentication → URL Configuration:**

- **Site URL**: `https://<your-app>.vercel.app`
- **Redirect URLs** — add all of these:
  ```
  https://<your-app>.vercel.app/auth/callback
  https://<your-app>.vercel.app/auth/confirm
  https://<your-app>-*.vercel.app/auth/**      ← preview deploys
  http://localhost:3000/auth/callback
  http://localhost:3000/auth/confirm
  ```

Skipping this is the single most common reason a magic link appears to do nothing: Supabase
refuses to redirect to a host that is not on the list.

## 6. Email template — makes cross-device sign-in reliable **[you, recommended]**

By default Supabase sends a PKCE link. PKCE binds the link to a `code_verifier` cookie stored on
the device that *requested* it, so a link requested on the Windows PC and opened on your phone
fails.

**Authentication → Email Templates → Magic Link**, replace the link with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to ContextShelf</a>
```

That form carries no device-bound secret, so the link works wherever you open it. The app handles
both shapes (`/auth/verify.ts`), so nothing breaks if you skip this — you just have to open the
link on the machine that asked for it.

---

## Verifying the deployment

Run these in order. Each is a Phase 1 exit criterion.

| Check | How | Pass looks like |
|---|---|---|
| A. Database | `npx supabase db diff --linked` | no differences |
| B. Auth | Sign in on the production URL | you land on `/home` |
| C. Refresh persistence | Create a topic, hard-refresh | topic still there |
| D. Logout/login | Sign out, sign in again | topic still there |
| E. Cross-device | See below | identical data both sides |
| F. RLS | `npm run test:db`, plus the live check below | isolation holds |
| G–I. CRUD | Create topic → nested subtopic → entries of several types | all persist |
| J. Provenance | Add entries with different Source values | badges show the right source |
| K. Current vs History | See below | Current shows the new one, Timeline keeps both |
| L. Responsive | `npm run test:responsive -- <url>` | no layout failures |
| M. Production | Open the URL on a phone | works over HTTPS |

### The cross-device test (the acceptance test)

**Device A — Mac**

1. Open the production URL, sign in.
2. Create topic `DailyRelay`.
3. Add subtopic `Branding`, then a nested subtopic `App Icon` under it.
4. Add three knowledge entries with different types and different Source values.
5. Add a next step. Edit Goal and Current State.

**Device B — Windows PC**

6. Open the same URL. Sign in with the same email.
7. Confirm everything from steps 2–5 is present. **No export or import.**
8. Change the Goal, add another knowledge entry, add a different next step.

**Back on Device A**

9. Reload. Device B's changes are there.

If step 7 or 9 fails, Phase 1 is not complete — stop and diagnose rather than proceeding.

### The live RLS check

`npm run test:db` already proves isolation against a real Postgres with the real policies. To
confirm the deployed project matches:

1. Sign in as a second email address (a `+test` alias works).
2. Confirm the second account sees an empty shelf.
3. Paste the first account's topic ID into the URL: `/topics/<id>`. Expect **Not found**, not the
   topic.

### The Current-vs-History check

1. On a topic, add entry `Use approach A`.
2. Supersede it with `Use approach B`, reason `A did not scale`.
   *(Phase 1 note: the supersede control is Phase 2 UI. Until then, verify via the database —
   `select supersede_entry('<id>', 'Use approach B', null, 'decision', 'A did not scale');`)*
3. Current State shows only B. The Timeline still shows A, labelled *Superseded*, with the reason.

---

## Local development

```bash
npm install
npm run dev            # http://localhost:3000
```

| Command | What it proves |
|---|---|
| `npm run build` | production build compiles |
| `npm run typecheck` | no type errors |
| `npm run lint` | no lint errors |
| `npm run test` | domain logic, error sanitising, adapter mapping |
| `npm run test:db` | the real migration applies, and RLS denies a second user — against a real ephemeral Postgres, no Docker or Supabase account needed |
| `npm run test:responsive -- <url>` | no horizontal overflow, correct nav per breakpoint, adequate touch targets |

`npm run test:db` needs a local PostgreSQL 16 (`postgresql-16` + `postgresql-contrib`). It creates
a throwaway cluster in `/tmp`, applies `supabase/migrations/`, runs `supabase/tests/*.test.sql`,
and tears everything down.

---

## Backups

- Supabase takes daily backups on paid plans; point-in-time recovery is a paid add-on. On the free
  tier, take your own: `npx supabase db dump -f backup.sql --linked`.
- Application-level JSON export/import lands in Phase 3.
- Nothing in the app hard-deletes: rows get `deleted_at` plus a `deletion_log` tombstone.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Redirected to `/setup` | Env vars missing or still the placeholder | The `/setup` screen names the missing variable. Set both `NEXT_PUBLIC_` vars and redeploy |
| `/setup` says the anon key is set but the publishable key is not | Following an older Supabase guide | Rename the variable to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and use the `sb_publishable_…` value |
| Magic link goes nowhere | Redirect URL not allow-listed | §5 |
| "Email link is invalid or has expired" on another device | PKCE link opened off-device | §6 |
| Signed in but "No workspace found" | Migration not applied | `npm run db:push` |
| Everything empty after signing in on the second machine | Different email address | Check the address; the shelf is per-account |
| Local `npm run dev` works, production does not | Env vars set locally only | Add them in Vercel, all three environments |
