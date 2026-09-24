# ToHim

ToHim is a mobile app for prayer-request tracking. It helps people intentionally
record their prayer requests instead of relying on memory or writing them down
somewhere and never returning to them.

The long-term vision is: **record prayers → organize them → return to them
consistently → track when they are answered → reflect on prayer over time.**
Not all of this is built yet — in particular, tracking whether a prayer has
been answered is still planned, not implemented (see
[Planned, not yet implemented](#planned-not-yet-implemented) below). What's
actually working today is recording, organizing, and returning to prayer
requests; see [Implemented features](#implemented-features).

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

## Planned, not yet implemented

These are part of ToHim's direction but are **not** present in the current
code (verified: no matching schema, fields, or UI):

- Marking a prayer request as answered / unanswered, or filtering by that status
- Attaching or searching Bible verses
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
2. Create a `.env` file in the repository root:
   ```env
   DATABASE_URL=your_postgres_supabase_connection_string_here
   OPENAI_API_KEY=your_openai_api_key_here
   JWT_SECRET=your_jwt_signing_secret_here
   PORT=3000
   ```
   `DATABASE_URL` is required — `server/postgres.js` exits immediately on
   startup if it isn't set. There is no SQLite fallback for the app's actual
   functionality.
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
