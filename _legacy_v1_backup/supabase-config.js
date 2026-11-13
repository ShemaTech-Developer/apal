// APALINK shared backend config — FREE Supabase (same project as PineNotes is fine, new tables)
// 1. supabase.com -> New project (free) or reuse PineNotes project
// 2. SQL Editor -> paste apalink-setup.sql -> Run
// 3. Settings -> API Keys -> copy Project URL + publishable key
// 4. Paste below. Until then APALINK runs per-browser.
window.APALINK_SUPABASE = {
  url: "https://YOUR-PROJECT-ref.supabase.co",
  anonKey: "YOUR-PUBLISHABLE-KEY",
  bucket: "apalinks"
};
