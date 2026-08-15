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
it bypasses RLS entirely. It lives in `SUPABASE_SECRET_KEY`, server-side only, never behind a
`NEXT_PUBLIC_` prefix, and **`/api/ingest` needs it**: a Claude Code delivery arrives with an
ingestion token and no browser session, so there is no JWT for a policy to read and the request
has to be authenticated before the database can be asked anything. Set it in the deployment's
production environment or the endpoint answers 503 with the reason. It is used in exactly one
place — `src/lib/adapters/supabase/service.ts` — by exactly one caller, and never reaches a
Server Component.

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
npx supabase link --project-ref <ref>    # prompts for the database password
npm run db:push
```

Verified against Supabase CLI **2.114.0**. Two things changed from older guides:

- `--token` is no longer a flag on `login`/`link`/`projects`. Non-interactive use reads
  `SUPABASE_ACCESS_TOKEN` from the environment instead.
- `link` now declares `--password` as required. With a terminal attached it prompts, so the
  command above is still correct interactively. Scripted, it is
  `npx supabase link --project-ref <ref> --password "$SUPABASE_DB_PASSWORD"`.

Never put the database password in a committed file or a shell history you sync.

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

## 3a. One command for the whole hosted sequence

From any environment that can reach Supabase (your own machine — not Claude Code on the web):

```
npm run provision
```

`scripts/provision.mjs` runs the entire remaining Phase 1 sequence and stops at the first real
failure:

**Supabase** — preflight (network reachability, `.env.local`) → `supabase login` → `link` →
`db push` → `db diff --linked` → `hosted/01_verify_schema.sql` → `hosted/02_rls_isolation.sql`

**Vercel** — `vercel login` → `link` → production/preview/development environment variables →
`deploy --prod` → capture the real URL → set `NEXT_PUBLIC_SITE_URL` to it → redeploy → smoke-test
`/login`, `/setup`, and `/home`

Environment values are piped from `.env.local` straight into the Vercel CLI's stdin; they are never
echoed, logged, or written anywhere by the script. `NEXT_PUBLIC_SITE_URL` is set to the canonical
production URL rather than a per-deployment preview URL, and the redeploy exists because
`NEXT_PUBLIC_*` values are inlined at build time.

Only two things are left afterwards, because Supabase exposes no API for them: the auth redirect
URLs and the two email templates. The script prints both, filled in with your real production URL.

It is plain Node, so it works in PowerShell, cmd, and any POSIX shell. Interactive steps hand the
terminal to the Supabase CLI, so the browser login and the database-password prompt are handled by
the CLI directly — the script never reads, stores, or echoes a credential.

Flags: `--skip-login`, `--skip-push` (validate only), `--skip-vercel`, `--project-ref <ref>`.

The preflight distinguishes a blocked host from an unreachable one. An egress gateway completes
the TLS handshake and then answers the request itself, so "the socket opened" is not evidence of
reachability — the check reads the response body and names an allowlist rejection as such.

## 3b. When the Postgres wire protocol is unreachable

Some environments allow HTTPS but not raw Postgres. This one does: the pooler's `:5432` and
`:6543` time out, and `db.<ref>.supabase.co` resolves IPv6-only with no IPv6 available. The
failure appears as a connect timeout *before* any password prompt, so it is easy to misread as an
authentication problem. It is not — `supabase link` succeeds without a password, and `db push`
fails the same way with or without one.

What still works, and what to use instead:

| Normally | When Postgres is unreachable |
|---|---|
| `supabase db push` | Management API `POST /v1/projects/{ref}/database/query`, then record history (§4a step 4) |
| `supabase db diff --linked` | `npm run schema:parity` |
| `psql` against the project | Same Management API endpoint |
| A browser pointed at the production URL | A local production build against hosted Supabase, plus HTTP checks of the real URL |

`npm run schema:parity` applies the real migration to a throwaway cluster and compares catalogs —
columns, enums, RLS, policies with their USING and WITH CHECK expressions, indexes, constraints,
triggers, and functions — against the hosted project. It is a catalog comparison, not a
byte-for-byte DDL diff, and it excludes extension-owned functions because the local shim installs
pgcrypto into `public` while hosted Supabase uses a dedicated `extensions` schema. Report its
result as catalog parity, never as "db diff clean".

## 3c. End-to-end validation

```bash
npm run validate:hosted -- <url>
```

Covers exit criteria B, C, D, E, F, G, H, I, J, and L against a real browser and the real hosted
database. It signs in by driving `/auth/confirm?token_hash=…` rather than by minting a session
cookie, so the app's own verification route, cookie writing, and middleware refresh are all
exercised. The admin key is used only to generate the link an email would otherwise carry, so no
mailbox is needed.

It asserts rows in the database, not just text on the page. That distinction caught a real false
pass: three forms on the topic page carry a hidden `topicId`, so a title-based check was satisfied
by an *action* created through the Open Issues form while `knowledge_entries` stayed empty.

The authenticated responsive audit runs inside this script, before its cleanup deletes the
throwaway accounts — a session handed to a later process is already invalid, which is why those
25 combinations reported as skipped for so long.

Test accounts use a `+contextshelf-qa` alias and are deleted in a `finally` block.

## 4a. Applying the migration when the CLI is unavailable

The CLI is the preferred path — it records migration history. If it cannot run (for example from a
sandboxed agent session with no outbound access to `supabase.co`), the SQL Editor is an acceptable
fallback **provided the exact repository file is used**. Never retype or reconstruct the schema.

1. Open `supabase/migrations/0001_init.sql` from this repository. Copy the entire file.
2. Supabase dashboard → **SQL Editor** → New query → paste → **Run**.
3. Record in `docs/DEVELOPMENT_STATE.md` that it was applied via the SQL Editor.
4. **Repair migration history** so future `db push` runs behave, once the CLI is available:
   ```bash
   npx supabase link --project-ref omhktzxwffaipmcoljic
   npx supabase migration repair --status applied 0001
   npx supabase db diff --linked      # must print no differences
   ```
   Without step 4, the CLI believes `0001` was never applied and will try to run it again.

### Verifying what actually landed

Two scripts in `supabase/tests/hosted/` report on the real project. Both are safe: the first only
reads catalogs, the second runs inside a transaction that is rolled back.

| Script | What it answers |
|---|---|
| `hosted/01_verify_schema.sql` | Are the 24 tables, RLS, policies, composite FKs, triggers, indexes, functions, and grants actually there? Returns a 15-row PASS/FAIL table |
| `hosted/02_rls_isolation.sql` | Does cross-user isolation hold *on this project*? Creates two throwaway users, exercises read/update/delete/attach/join-workspace as each, then rolls back |

Both are smoke-tested against a real PostgreSQL by `npm run test:db`, so they are known to run
before they touch production.

`npm run provision` runs both automatically. To run one on its own:

```
npx supabase db query --linked -f supabase/tests/hosted/01_verify_schema.sql
```

`supabase db query --linked -f <file>` exists in CLI 2.114.0 (confirmed against the installed
binary's help). The SQL Editor is therefore a convenience, not a requirement.

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

**Two templates need this, not one.** `signInWithOtp()` sends the *Confirm signup* template to an
address that has never signed in, and the *Magic Link* template thereafter. Updating only Magic
Link leaves first-ever sign-in on the PKCE path.

**Authentication → Email Templates → Magic Link:**

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in to ContextShelf</a>
```

**Authentication → Email Templates → Confirm signup:**

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a>
```

`/auth/confirm` and `/auth/callback` both route into `src/app/auth/verify.ts`, which accepts
`type` values of `magiclink`, `signup`, and `email` and rejects anything else, then calls
`verifyOtp({ type, token_hash })`. These templates match that implementation exactly.

Neither form carries a device-bound secret, so the link works wherever you open it. The app still
handles PKCE `code` links, so nothing breaks if you skip this — you just have to open the link on
the machine that requested it, which defeats the Mac/Windows workflow.

Do not change any other template. Password recovery and email-change flows are not implemented.

---

## 6a. Email templates on the free tier

§6 cannot be completed on a free-tier project using the default email provider. Both the
Management API and the dashboard refuse:

> Email template modification is not available for free tier projects using the default email
> provider. Please upgrade your plan or configure a custom SMTP provider.

Until a paid plan or custom SMTP is in place, Supabase sends its default PKCE-shaped link. The app
handles that shape, so sign-in works — but the link is bound to the device that requested it, so
open it on that device. This is the one part of AD-13's promise that configuration alone cannot
deliver.

## Status: Phase 1 is provisioned and closed

This document is now a runbook for reproducing the setup, not a list of things still to do. As of
2026-08-14 the hosted project and the deployment both exist and are validated:

| | |
|---|---|
| Production URL | <https://contextshelf.vercel.app> |
| Supabase project | `omhktzxwffaipmcoljic` — 24 tables, 31 policies, migration `0001` recorded |
| Auth | Site URL and five redirect URLs set |
| Cross-device | **Passed on two physical machines**, both directions |

The one step that could not be completed is §6, the email templates — see §6a. Everything else in
§§1–5 is done.

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

> **Passed 2026-08-14** on two physical machines: data created on the Work PC appeared on the Mac,
> and an update made on the Mac appeared back on the Work PC. No export, no import. The steps
> below remain the procedure for re-verifying after any change to auth, session handling, or the
> data layer.

**Device A — whichever machine you are at now (Windows PC or Mac)**

1. Open the production URL, sign in.
2. Create topic `DailyRelay`.
3. Add subtopic `Branding`, then a nested subtopic `App Icon` under it.
4. Add three knowledge entries with different types and different Source values.
5. Add a next step. Edit Goal and Current State.

**Device B — the other machine (or a phone)**

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

## Running the provisioning steps on Windows

The commands in this document are shell-agnostic except where noted. On Windows, run them in
**PowerShell** from the repository folder. Three differences matter:

| | macOS / Linux | Windows PowerShell |
|---|---|---|
| Set an env var for one command | `FOO=bar cmd` | `$env:FOO="bar"; cmd` |
| Copy the env template | `cp .env.example .env.local` | `Copy-Item .env.example .env.local` |
| `npm run test:db` | works (needs PostgreSQL 16) | **not supported** — the harness is a bash script |

`npm run test:db` uses `scripts/db-test.sh`, which needs bash plus the PostgreSQL 16 server
binaries. On Windows run it under **WSL** or **Git Bash** with PostgreSQL installed, or skip it —
it validates the migration locally and is not required for provisioning the hosted project. The
hosted scripts in `supabase/tests/hosted/` are the ones that matter against the real project, and
those run through the Supabase SQL Editor or the CLI regardless of operating system.

Everything else — `npm run build`, `typecheck`, `lint`, `test`, `test:responsive`, the whole
`supabase` CLI sequence, and the Vercel CLI — works identically on Windows.

## Which environment can do what

Verified 2026-08-14, on a Claude Code web session whose network policy permits HTTPS to the
Supabase and Vercel hosts. An earlier revision recorded those hosts as blocked entirely; that is
no longer accurate, and the replacement constraint is narrower.

| Task | Claude Code on the web | Claude Code CLI, run locally |
|---|---|---|
| Build, typecheck, lint, unit tests | yes | yes |
| `npm run test:db` (ephemeral Postgres) | yes | yes (needs local PostgreSQL 16) |
| Git push to GitHub | yes | yes |
| Set the GitHub **default branch** | no — proxy blocks repo-settings writes | yes |
| `supabase login` (device code) | yes, with a pty; see below | yes |
| `supabase link` | yes | yes |
| `supabase db push` / `db diff --linked` | **no** — Postgres wire protocol unreachable | yes |
| Apply the migration | yes, via the Management API (§4a) | yes |
| Hosted schema + RLS validation | yes, via the Management API | yes |
| Schema parity | yes, `npm run schema:parity` | yes, or `db diff --linked` |
| `vercel login` / deploy | yes | yes |
| Browser against the **deployed** URL | **no** — Chromium's tunnels are reset | yes |
| Browser against a **local** build on hosted Supabase | yes | yes |

Two details that cost real time, recorded so they do not have to be rediscovered:

- **The Supabase and Vercel CLIs fail through an explicit `HTTPS_PROXY`.** Supabase reports a bare
  `Transport error` and Vercel's device-code poll reports `fetch failed`, while `curl` and Node's
  `fetch` reach the same hosts. Where egress is transparently routed, unsetting the proxy
  variables for those child processes fixes it without weakening anything — TLS verification is
  untouched and the same egress policy still applies. `scripts/provision.mjs` does this.
- **`supabase login` needs a real terminal, and the pty needs a window size.** A pty opens at 0x0,
  and the CLI's prompt divides by the terminal width to decide where to wrap — at zero columns it
  wraps every character onto its own line, emits cursor-up runs of 150+ lines, and never processes
  input coherently. Set `TIOCSWINSZ` to something real (120x40). The prompt also submits on
  carriage return, not newline. Alternatively, skip the flow entirely by setting
  `SUPABASE_ACCESS_TOKEN`, which `npm run provision` reads.

Claude Code on the web runs the agent in Anthropic's cloud, on Linux — not on the machine whose
browser you are using. It cannot see your `C:` drive or your local clone, and it cannot complete
the cross-device acceptance test, which by definition needs two physical machines. To have the
agent work on your own machine:

```powershell
npm install -g @anthropic-ai/claude-code
git clone https://github.com/edarelland-code/anthropic-claude-code
cd anthropic-claude-code
claude
```

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


---

## Optional: AI-assisted extraction

ContextShelf works fully without this. Deterministic extraction — the built-in provider — needs no
credential, sends nothing anywhere, and powers the whole Analyze &amp; review workflow. Everything
below is about the optional model-backed provider.

Two server-side environment variables, both required to enable it:

```
ANTHROPIC_API_KEY=sk-ant-…        an Anthropic API key
CONTEXTSHELF_EXTRACTION_MODEL=…   the model identifier to use
```

**There is no default model, deliberately.** A default in code would assert that some particular
model had been chosen and validated for this task. With the key set and the model unset, the
provider stays `Not configured` and says which piece is missing.

**The validated model is `claude-sonnet-5`.** It is what this deployment is configured with and
what the live provider validation (`npm run validate:provider`) was run against, end to end.
Any other current Claude model identifier from Anthropic's published list should work; only this
one has been exercised. Record the identifier here when you change it — "which model produced this
suggestion" is an audit question, and every extraction run stores its answer in `extraction_runs.model`.

**Scope both variables to the environments that need them.** `ANTHROPIC_API_KEY` and
`CONTEXTSHELF_EXTRACTION_MODEL` are set for Preview and Production. `SUPABASE_SECRET_KEY` is
Production only, which is why `/api/ingest` answers `503 SUPABASE_SECRET_KEY is not set` on a
preview deployment — the endpoint runs as `service_role` and correctly refuses rather than
proceeding without it.

**There is no place in the app to paste the key**, and that is also deliberate. Storing a key per
user would mean encrypting it at rest, which would mean a key-management dependency this deployment
does not have. It lives in the Vercel production environment beside `SUPABASE_SECRET_KEY` — never
behind a `NEXT_PUBLIC_` prefix, never in a table, never in git, never in a log, and never in any
response.

**What a request costs is not stated anywhere in this product.** ContextShelf records input and
output token counts from the provider's own response and displays those. Turning tokens into money
requires current published pricing for the model you configured, and a figure quoted from a stale
rate would be worse than none.

**When a request happens.** Only when a signed-in person presses *Extract suggestions*, and only
after the credential-warning gate if the source looks like it contains secrets. Claude Code
deliveries through `/api/ingest` never trigger one — that path cannot reach the extraction layer at
all, which is asserted in `src/lib/extraction/readiness.test.ts` rather than left as an intention.
