# ToHim

ToHim is a mobile app for prayer-request tracking. It helps people intentionally
record their prayer requests instead of relying on memory or writing them down
somewhere and never returning to them.

The long-term vision is: **record prayers → organize them → return to them
consistently → track when they are answered → reflect on prayer over time.**
Not all of this is built yet — see [Planned, not yet implemented](#planned-not-yet-implemented)
below for what's still ahead, and [Implemented features](#implemented-features)
for what's actually working today, including marking a prayer answered and
attaching Bible verses.

This is a CS-195 capstone project.

## Current status

ToHim began as a general relationship/interaction tracker (internally, "Tabbe")
and has since been repurposed toward prayer tracking. The app is in
**Alpha-stage development**. The features below are verified against the
current source code, not the eventual product vision — see
[Planned, not yet implemented](#planned-not-yet-implemented) for what's still
ahead.

## Implemented features

- **Record a prayer request** by voice or text (`mobile/screens/SessionScreen.js`).
  OpenAI is used to parse the description, extract any person mentioned, and
  generate structured notes.
- **People associated with prayer requests**: a profile is created automatically
  for each person you mention, and you can browse people and their linked
  requests (`PeopleScreen`, `PersonDetailScreen`).
- **Calendar view** of recorded prayer requests by date (`CalendarScreen`).
- **Natural-language Q&A over your prayers and people** — the "Ask ToHim" tab
  lets you ask questions like "what did I pray for Joel about last week?" and
  get an answer grounded in your own recorded notes (`RemindMeScreen`,
  `server/services/aiService.js`, backed by vector search over your notes).
- **Authentication and profile setup**: register/login/verify, initial profile
  setup, and account/settings/privacy screens.
- **Groups**: people can be organized into groups, and you can ask questions
  about a whole group at once.
- **Mark a prayer request answered or unanswered**, with an optional note on
  how it was answered. Tap a prayer request card in a person's profile to
  open its detail screen (`PrayerRequestDetailScreen`), where the status is
  shown and can be toggled. Persisted in Postgres (`sessions.answered`,
  `answered_at`, `answered_note`), so it survives app/backend restarts.
- **Attach a Bible verse to a prayer request**: search by keyword (e.g.
  "peace") or reference (e.g. "Philippians 4:6-7") from the request detail
  screen (`VerseSearchScreen`), then add a result to the request. Verses are
  proxied server-side through [api.bible](https://scripture.api.bible/) (see
  Setup below) and stored in a `session_verses` table — the API key never
  reaches the mobile app. Requires `BIBLE_API_KEY`/`BIBLE_API_BIBLE_ID` to be
  configured; without them, search returns a clear "not configured" message
  instead of failing silently.

## Planned, not yet implemented

These are part of ToHim's direction but are **not** present in the current
code (verified: no matching schema, fields, or UI):

- Dedicated prayer categories (today there's only the general-purpose "groups"
  feature carried over from the earlier app)
- Prayer reminders or scheduled notifications
- Weekly/monthly prayer analytics
- Sharing prayer requests with other users

## Technology stack

- **Mobile**: React Native + Expo
- **Backend**: Node.js + Express
- **Database**: Postgres (Supabase) is the application's active data store —
  every route (`sessions`, `persons`, `groups`, `calendar`, `auth`) reads and
  writes through `server/postgres.js`. `server/database.js` (SQLite) still
  initializes on server startup but is legacy/vestigial: no route reads from
  or writes to it. Migration scripts that originally moved data from SQLite
  to Supabase live under `server/scripts/`.
- **AI**: OpenAI API for extracting structured data from prayer request text
  and for answering natural-language questions; a vector store
  (`server/services/vectorStore.js`, Pinecone) backs semantic search over notes

## Setup

### Prerequisites

- Node.js (v18+) and npm
- An OpenAI API key ([get one here](https://platform.openai.com/api-keys))
- For mobile development: the Expo Go app on your phone, or an iOS
  Simulator/Android Emulator

### Backend

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the repository root (see `.env.example`):
   ```env
   DATABASE_URL=your_postgres_supabase_connection_string_here
   OPENAI_API_KEY=your_openai_api_key_here
   JWT_SECRET=your_jwt_signing_secret_here
   PORT=3000
   BIBLE_API_KEY=your_api_bible_key_here
   BIBLE_API_BIBLE_ID=your_chosen_bible_id_here
   ```
   `DATABASE_URL` is required — `server/postgres.js` exits immediately on
   startup if it isn't set. There is no SQLite fallback for the app's actual
   functionality. `BIBLE_API_KEY`/`BIBLE_API_BIBLE_ID` are only needed for the
   Bible verse search feature; without them the rest of the app still runs,
   and verse search returns a clear configuration error instead of crashing.
   Get a free key at [api.bible](https://scripture.api.bible/) (Starter plan:
   5,000 calls/month, non-commercial use) and pick a Bible ID from
   `GET /v1/bibles` in their docs (e.g. a public-domain KJV translation).
3. Start the backend:
   ```bash
   npm start
   # or, with auto-reload:
   npm run dev
   ```
   The server listens on `http://localhost:3000` by default. Keep it running
   while using the mobile app.

### Mobile app

1. From `mobile/`, install dependencies:
   ```bash
   cd mobile
   npm install
   ```
2. Point the app at your backend by setting the API URL in
   `mobile/services/api.js` (or `expo.extra.apiBaseUrl` in `mobile/app.json`):
   - iOS Simulator: `http://localhost:3000/api` (default)
   - Android Emulator: `http://10.0.2.2:3000/api`
   - Physical device: `http://YOUR_COMPUTER_IP:3000/api`
3. Start the Expo dev server:
   ```bash
   npm start
   ```
4. Scan the QR code with Expo Go, or press `i` (iOS simulator), `a` (Android
   emulator), or `w` (web).

### Tests

Backend tests use Node's built-in test runner (Node 21+), so there's nothing
extra to install:

```bash
npm test
```

They cover the prayer-request pipeline: extracting people from a description
(`server/tests/aiService.extraction.test.js`) and creating/matching people and
storing notes through `POST /api/sessions` (`server/tests/sessions.pipeline.test.js`).
OpenAI, Postgres, Pinecone, and auth are replaced with in-memory fakes
(`server/tests/helpers/mocks.js`), so tests need no `.env`, network, or API key.

## Project structure

```
server/           Express backend (Postgres/Supabase, routes, AI service)
mobile/           Expo/React Native app (screens, components, services)
docs/             Public support/privacy pages
scripts/          App Store screenshot generation and other tooling
```

## Deployment

For TestFlight distribution, see [TESTFLIGHT_GUIDE.md](TESTFLIGHT_GUIDE.md) and
[mobile/QUICK_START_TESTFLIGHT.md](mobile/QUICK_START_TESTFLIGHT.md).
