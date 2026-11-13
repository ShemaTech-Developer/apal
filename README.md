# APALINK — APADE High School

**APALINK — Connecting Minds. Empowering Learning.** The school notes platform for APADE High School, the current codebase.

**Milestone 1:** foundation, welcome + role selection, student & teacher authentication, SQLite, backend auth.
**Milestone 2:** Student & Teacher dashboards + the full Notes Management System.
**Milestone 3:** Administrator class-by-class Timetable Management, real-time school Messaging (student↔student, student↔teacher with department-aware inbox), and the full Account Settings center (dark mode, sessions, privacy, notifications, regional).
**Milestone 4:** Administrator console with user control and content moderation.
**Milestone 5:** Rwandan school selection at student registration, school announcements, a fully styled admin command centre with charts, admin↔user direct messaging, global dashboard search, multi-format note preview, and per-user activity history with delete.
**APALINK redesign (this build):** blue design system, Lucide-style SVG icon set (no emoji), APADE-branded homepage with floating search, one unified sign-in page (student/teacher tabs + discreet administrator section), and admin **Assign Teachers** with unique TC codes.

## APALINK

- **Homepage** (`public/index.html` + `public/js/home.js`): APADE crest with translucent APALINK branding over both campus photos (crossfading hero, blue/dark overlay), tagline *Connecting Minds. Empowering Learning.*, and a floating search panel — opens on focus, filters quick links live, closes on outside click/Esc, Enter opens the top result.
- **Blue design system:** navy primary controls (`--action`), medium-blue navigation, light-blue/white surfaces, very light blue-grey backgrounds; dark theme is blue-tinted. Yellow survives only as tiny decorative accents (active-nav marker, admin sidebar wordmark).
- **Icons:** 68 Lucide-style outline SVGs (ISC) vendored in `public/js/icons.js` — `NN.icon(name,size)` / `NN.paintIcons()` / `<span data-icon>`. No emoji in buttons, nav, or UI chrome; text arrows (← → ↗), ✓/✓✓ seen ticks and ● ○ presence dots are kept as typography.
- **Unified sign-in** (`pages/student-login.html`): Student/Teacher tabs on one form (server chooses the endpoint; the school-code step appears inline when the server asks for it), a discreet **Administrator access** section at the bottom with the existing two-step server-checked gate, and APALINK crest branding. Legacy `teacher-login.html`, `teacher-verify.html`, `admin/login.html` redirect here (`#teacher` / `#access` deep links). No credentials exist in frontend code.
- **Assign Teachers** (Admin console): create teachers (name, username, temporary password, subject) with an auto-unique **TC + numeric code** (TC001…) stored in the DB; search by name/username/subject/code, edit, activate/deactivate, reset password. Passwords bcrypt-hashed; endpoints admin-session-only.

## Run it

```bash
cd ~/Desktop/APALINK
npm install
npm start          # → http://localhost:4000
```

Flow: Student → register with **district + Rwandan school**, section + level → Student Dashboard. Teacher → verify school code → choose the **school where you teach** at registration → Teacher Dashboard. Teachers receive that school's announcements and updates, then Publish a Note (title, section, level, class optional, subject, description, file ≤ 25 MB). Matching students see it automatically. **No demo notes are seeded** — if nothing is published, every screen shows a proper empty state, and Downloads stays empty until the first real download.

**Sign-in:** the homepage and every auth page lead to **one unified sign-in** (`pages/student-login.html`) — Student and Teacher tabs share a single form, and a discreet **Administrator access** disclosure at the bottom holds the two-step gate: first the shared **school password**, then the administrator username/password. The school-password check expires after 10 minutes, and both steps are enforced on the server. Deep links: `student-login.html#teacher` (teacher tab) · `student-login.html#access` (admin section).

**Note preview:** Preview opens `/pages/preview.html?note=…`. PDFs are embedded inside the app with an iframe plus **Open in new tab** and a phone hint for the device PDF viewer; images support click-to-fullscreen; text/Markdown/CSV/JSON/HTML render inline; Word/PowerPoint files show a download card. Every preview honours the same server-side access rules as the note list.

**School announcements:** Admin Console → Announcements. Choose category (general, academic, event, urgent), audience (everyone, students, teachers), optional school, pin-to-top and publish/draft. Published announcements notify their audience and appear on `/pages/announcements.html` and on student/teacher overviews.

**Global search (M5):** every student/teacher dashboard has a search bar at the top (`/` focuses it). It finds notes the user may access, people (with a **Message** deep-link) and announcements — all filtered by the same access rules. The admin console has its own app-wide search.

**Timetables:** Administrator (unified sign-in → Administrator access, credentials in `ADMIN_USERNAME`/`ADMIN_PASSWORD` env; dev default `admin / @dministr@tion` — change before production, env is authoritative and synced on every start) → Timetable Management → per class: upload PDF/PNG/JPG and/or build entries in the weekly editor (conflict warnings for teacher/room/class overlaps, override available) → Publish (replaces the previous version; students & assigned teachers notified). Students see it at **My Timetable**; teachers at **My Teaching Schedule**.

**Admin console:** Teachers get an **Admin** entry in the left sidebar → admin sign-in (unified page, discreet section) → a fully styled command centre (`pages/admin/index.html`, navy sidebar, dark-mode aware with a header toggle, mobile drawer). Sections:
- **Dashboard** — stat cards, a 7-day activity chart (actions + sign-ins), uploaded-files donut by type, most-downloaded notes, a who-downloaded table and a live activity feed.
- **Users** — every student/teacher with school, district, section/level/class, activity stats; filter, inspect, activate/deactivate, reset password, delete and direct Message.
- **Assign Teachers** — create teacher accounts with unique **TC codes** (TC001…), search by name/username/subject/code, edit, activate/deactivate and reset passwords. Usernames and codes are unique; passwords are bcrypt-hashed.
- **Notes & files** — every uploaded file, owner, size, downloads, publish/unpublish, open-in-browser and delete.
- **Announcements / Messages / Reports / Schools** — publish school news, direct-message any user and read replies, resolve reported messages, and extend/activate the Rwandan school catalogue.
- **Timetables** — links to the M3 timetable manager.

Admin credentials come from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`; dev default `admin / @dministr@tion`. The env is authoritative and re-synced on every server start. The administrator sign-in first asks for the shared school password (`TEACHER_ACCESS_CODE`), then the admin account password. Teacher credentials never grant admin access, and every admin action is activity-logged.

**Messages:** sidebar Messages → **Find people** at the top (search by name or username) and your chats below. Tap a person to open a chat and type immediately. The page shows who is **active now** (presence dot), **✓ Sent / ✓✓ Seen** ticks on your messages, and lets you delete your own messages. It also supports live updates via SSE with automatic polling fallback (5s), block/unblock, reporting, and the **School Administration** thread. Department/class info always comes from the student's DB profile. Results from global search and the directory open the conversation directly (`?with=role:id`). Attachments: images, PDFs, Word/PowerPoint and other documents ≤ 25 MB — preview inline, download through a permission-checked endpoint.

**Settings & activity history:** sidebar Settings → profile (display name, username with uniqueness, avatar), Appearance (light/dark/system stored on the server and synced across devices), Security (change password, logout everywhere, session list), Privacy (who can message me, profile/online visibility), Notification toggles, Language/region. A **light/dark toggle sits in the top-right of every student/teacher page** and saves the choice to the account. Profile and Settings also show **Activity history** — the user's own recent tasks and actions with per-entry delete and **Clear my history**. Deleting hides entries from the user's view while the administrator's safety audit trail is preserved. Official section/level/class/school cannot be changed in settings.

## School access password

Used for **two** gates: teacher verification and the first step of administrator sign-in. Checked **only on the backend** (`server/routes/auth.js`) against `TEACHER_ACCESS_CODE`. `.env` (git-ignored) holds it; `.env.example` shows the placeholder. Valid 10 minutes per session; never in frontend code.

## Project structure

```
APALINK/
├── public/
│   ├── index.html              # APALINK homepage: hero campus photos, crest branding, floating search
│   ├── pages/
│   │   ├── student-login.html  # APALINK unified sign-in (student/teacher tabs + admin section); teacher-login/teacher-verify/admin/login redirect here
│   │   ├── student-register/teacher-register  (register adds district + school, teachers also pick their school)
│   │   ├── home.html           # M2: role-based dashboard redirect (M3: admin-aware)
│   │   ├── preview.html        # M2/M5: multi-format note preview (embedded PDF, image zoom, text, Office card)
│   │   ├── announcements.html  # M5: school announcements (both roles)
│   │   ├── messages.html       # M3/M5: school messaging + School Administration thread + attachments
│   │   ├── notifications.html  # M3: in-app notifications
│   │   ├── student/            # overview, my-notes, recent, saved, downloads, timetable (M3), profile, settings (M3 + M5 history)
│   │   ├── teacher/            # overview, my-notes, publish, stats, schedule (M3), profile, settings (M3 + M5 history)
│   │   └── admin/              # index.html (console incl. Assign Teachers), login (redirect), timetable-management, reports
│   ├── css/                    # main.css (blue system + icon styles + dark mode), auth.css (hero + unified login), dashboard.css, admin.css, responsive.css
│   ├── js/                     # main.js, icons.js (68 Lucide SVGs), home.js (hero search), auth.js (unified login), dashboard.js, timetable.js, messages.js, settings.js, admin.js, image-slider.js
│   └── assets/                 # logo/, images/ (6 local photos), brand/ (APADE crest, campus photos, hero JPGs), icons/
├── server/
│   ├── app.js                  # Express + sessions + static (+ all APIs through M5)
│   ├── lib/helpers.js          # M3: requester, preferences, notifications, activity log, SSE hub
│   ├── routes/auth.js          # Auth + schools/districts + registration with schoolId
│   ├── routes/notes.js         # M2: student library + teacher publish/manage + secure file serving (admin access in M5)
│   ├── routes/timetable.js     # M3: admin timetable CRUD + conflict validation + publish/replace + student/teacher views
│   ├── routes/messaging.js     # M3/M5: directory, conversations, blocks, reports, SSE + admin↔user thread
│   ├── routes/settings.js      # M3/M5: preferences, profile/avatar, sessions, notifications, activity history
│   ├── routes/announcements.js # M5: announcements + school catalogue management
│   ├── routes/search.js        # M5: global notes/people/announcements search
│   ├── routes/admin.js         # M4/M5: dashboard charts, user control, Assign Teachers (TC codes), notes moderation, admin direct messaging
│   ├── middleware/auth.js
│   └── database/db.js          # SQLite init + seed (departments, levels, Rwandan schools, admin bootstrap, teacher_code backfill)
├── database/schema.sql         # M1–M5 tables (incl. schools, announcements, admin_messages, hidden activity)
├── data/uploads/               # notes/, timetables/, avatars/ (never public; served via authenticated API)
├── tests/smoke.test.js         # M1 auth regression (npm test)
├── tests/notes.test.js         # M2 end-to-end (npm run test:notes) — cleans up after itself
├── tests/m3.test.js            # M3 end-to-end (npm run test:m3) — cleans up after itself
├── tests/admin.test.js         # M4 admin + Assign Teachers end-to-end (npm run test:admin) — cleans up after itself
└── tests/m5.test.js            # M5 end-to-end (npm run test:m5) — cleans up after itself
```

## Access rules (enforced server-side, never in the browser)

- **Students** see only **published** notes in their **section + level**, and only their class if the note targets a class (`class_name` match; blank = whole level). Unpublished and out-of-scope notes are invisible, and their files return 403.
- **Teachers** manage only their own notes. Students cannot publish.
- **Students** see only the timetable of their own class scope; other-class students get nothing. **Teachers** see only lessons where they are the assigned teacher.
- **Messages:** conversation membership is verified on every read/write; outsiders get 403. Blocks, rate limits (20/min), privacy preferences (`messagePrivacy`), and message reports + admin moderation are enforced server-side. Directory responses never include emails or password data.
- **Announcements (M5):** users only receive published announcements addressed to their role; school-targeted announcements only reach students **and teachers** of that school. Drafts and other audiences are invisible.
- **Search (M5):** notes are filtered by the same section/level/class/publish rules as the library; users cannot search private data, and admin search is the only app-wide branch.
- **Activity history (M5):** users can hide only their own entries (`hidden_by_user`); the audit trail remains visible to administrators.
- **Preview/admin files (M5):** note files are still streamed only through `/api/notes/:id/file` with a server-side permission check; admins may open any note file.

## Database (`data/apalink.db`)

`departments` (11 seeded) · `academic_levels` (6) · `classes` · `students` (M5: `school_id`) · `teachers` (M5: `school_id`) · `admins` (M3) · `sessions` · `notes` · `note_files` · `note_downloads` · `saved_notes` (M2) · `academic_periods` · `timetable_documents` · `timetable_entries` · `conversations` · `conversation_participants` · `messages` · `message_reports` · `user_blocks` · `user_preferences` · `notifications` · `activity_log` (M3; M5: `hidden_by_user`) · `schools` (M5, 59 Rwandan schools across 30 districts) · `announcements` (M5) · `admin_messages` (M5). Migrations are additive only (`IF NOT EXISTS` + column checks) — existing tables/records are preserved.

## API

Milestone 1: `GET /api/health` · `GET /api/auth/departments|levels|districts|schools` · student/teacher register+login · `POST /api/auth/teacher/verify` · `GET /api/auth/me` · `POST /api/auth/logout` (+ admin entry: `POST /api/auth/admin/verify-school` then `POST /api/auth/admin/login`; `POST /api/auth/change-password`).

Milestone 2:
- `GET /api/student/dashboard` — real stats + newest notes as notifications
- `GET /api/student/notes?q&subject&type&sort` · `/recent` · `/saved` · `/downloads`
- `POST|DELETE /api/student/notes/:id/save`
- `GET /api/notes/:id/file?mode=preview` — permission-checked streaming; `attachment` mode logs a download for students
- `GET /api/teacher/dashboard` · `POST /api/teacher/notes` (multipart, single file) · `PATCH /api/teacher/notes/:id` (edit/publish-toggle) · `DELETE /api/teacher/notes/:id` (removes note + file)

Milestone 3:
- Admin: `GET /api/admin/overview|periods|teachers|timetables|timetables/:id|reports` · `POST /api/admin/periods|timetables|timetables/:id/entries|timetables/:id/publish|unpublish|archive|reports/:id/resolve` · `DELETE /api/admin/timetables/:id|timetables/:id/entries/:entryId`
- Timetable views: `GET /api/student/timetable` · `GET /api/teacher/schedule` · `GET /api/timetables/docs/:id/file`
- Messaging: `GET /api/messages/directory|conversations|conversations/:id/messages|unread|blocks|stream` · `POST /api/messages/conversations|conversations/:id/messages|conversations/:id/read|report|block` · `DELETE /api/messages/block`
- Settings/notifications: `GET|POST /api/settings/prefs` · `POST /api/settings/profile|avatar|change-password|logout-all` · `GET /api/settings/sessions` · `GET /api/notifications` · `POST /api/notifications/:id/read|read-all`

Milestone 4:
- `GET /api/admin/dashboard|users|users/:role/:id|notes|conversations|conversations/:id/messages|reports`
- `POST /api/admin/users/:role/:id/active|reset-password|notes/:id/publish|messages/:id/hide|reports/:id/resolve`
- `DELETE /api/admin/users/:role/:id|notes/:id|messages/:id|conversations/:id`

Assign Teachers (admin-session-only; `GET /api/admin/teachers` stays reserved for the timetable dropdown):
- `GET /api/admin/assign-teachers?q=` · `POST /api/admin/assign-teachers` (201, returns `teacherCode`) · `PATCH /api/admin/assign-teachers/:id`
- `POST /api/admin/assign-teachers/:id/reset-password` · `POST /api/admin/assign-teachers/:id/active`

Milestone 5:
- Schools: `GET /api/auth/schools?district` · `GET /api/auth/districts` (public, for registration); `GET|POST /api/admin/schools` · `POST /api/admin/schools/:id/active`
- Announcements: `GET /api/announcements|announcements/latest` · `GET|POST /api/admin/announcements` · `PATCH|DELETE /api/admin/announcements/:id`
- Global search: `GET /api/search?q=` (notes, people, announcements — role-filtered)
- Activity history: `GET /api/settings/activity` · `DELETE /api/settings/activity/:id` · `DELETE /api/settings/activity`
- Admin direct messaging: `GET /api/admin/message-threads|message-threads/:role/:id` · `POST /api/admin/message-threads/:role/:id`; user side: `GET|POST /api/messages/admin-thread` · `POST /api/messages/admin-thread/read`
- Admin dashboard extras: `charts.activity7`, `charts.uploads`, `charts.mostDownloaded`, `charts.recentDownloads`, `charts.activeUsers7d`; admin file preview: `GET /api/notes/:id/file?mode=preview`

## Tests

```bash
npm test            # Milestone 1 auth regression
npm run test:notes  # Milestone 2: publish → access rules → search → save → download → unpublish → delete
npm run test:m3     # Milestone 3: timetable (+conflicts/publish/replace/notify) → messaging (student↔student↔teacher, blocks, reports, moderation) → settings (prefs, username, password)
npm run test:admin  # Milestone 4: admin login, user control, moderation
npm run test:m5     # Milestone 5: schools/registration → announcements (audience/school) → global search → admin file preview + charts → admin↔user messaging → activity history → school catalogue
```

The M2 test creates a real note with a real file, proves the wrong-level student cannot see or download it, proves save/download tracking, then **deletes the note and test users** — verified afterwards: `notes: 0, downloads: 0, saved: 0`.

The M5 test creates its own students/teacher/note/announcements and cleans up every record and uploaded file afterwards. It verifies that the wrong school/audience cannot see an announcement, that search respects note access, that admin file preview works, that chart data contains real downloads, and that a user's history clears while the admin audit log keeps the hidden entries.

The admin test also covers **Assign Teachers**: 401 without an admin session and for students, 201 + `TC###` code on create, 409 on duplicate usernames (create and edit), 400 on weak passwords, search by code, edit, global code uniqueness, deactivate → login 401 → reactivate → 200, and reset-password (old 401 / new 200).

## Legacy note

The previous single-file APALINK front-end is preserved in `_legacy_v1_backup/` for reference — not loaded by this app.
