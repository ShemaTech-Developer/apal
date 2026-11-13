# APALINK — School Notes, Shared 🟨

A **new, separate app** from PineNotes. Yellow + white, light mode, modern UI, advanced **N** logo.

## Flow (exactly as requested)
1. Visitor finds APALINK → **Choose: Teacher or Student**
2. **Student:** Full name, username, **Section** (9 departments + Mathematics and Sciences Stream One/Two), **Class**, **Level** (Level 3, 4, 5, Senior 4, 5, 6), password + confirm → continue
3. **Teacher:** Enter school password **`APADE@2026`** → create teacher account (no section/department choice) → Teacher Dashboard
4. **Students** see only notes matching their **section + level**, can preview/download/search
5. **Teachers** publish notes choosing **section + level** + title/description/files (50 MB), see/delete/download their own published notes
6. **Admin** page: see all users/files, delete users/files, control the app

## Pages (real pages, not scrolling)
Home · Notes · Dashboard · Publish · Favorites · About · Help · Admin · Account — sidebar navigation opens each page.

## Design
White + light mode, **yellow #FFD34E** primary, orange accent, ink text. Student pages: orange-yellow library theme. Teacher pages: classroom theme. Advanced **N** logo (yellow square, black N, orange node).

## Run locally
```bash
cd ~/Desktop/APALINK
python3 -m http.server 8000
# open http://localhost:8000
```

## Shared backend (free Supabase, 1-time)
1. supabase.com → New project (free) — you may reuse the PineNotes project
2. SQL Editor → paste `apalink-setup.sql` → Run (creates `apalink_users`, `apalink_notes`, bucket `apalinks`)
3. Settings → API Keys → copy Project URL + publishable key → paste into `supabase-config.js`
4. Deploy to Vercel (drag folder or GitHub) → students/teachers share the same library

## Files
`index.html` (SPA pages) · `style.css` · `app.js` · `manifest.json` · `sw.js` · `apalink-icon.svg` + PNGs · `supabase-config.js` · `apalink-setup.sql` · `vercel.json`
