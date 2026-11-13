// Persistent file-backed session store for express-session.
// Extends the official express-session Store so all required interface
// methods (get/set/destroy/touch/load/createSession/regenerate + events) are present,
// while data lives in a JSON file instead of memory.
const fs = require('fs');
const { Store } = require('express-session');

function createSessionStore(file) {
  const store = new Store();
  const filePath = file;
  const cache = new Map();

  function load() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const obj = raw ? JSON.parse(raw) : {};
      for (const k of Object.keys(obj || {})) cache.set(k, obj[k]);
    } catch (e) { /* first run or corrupt file -> start empty */ }
  }
  function save() {
    try {
      const obj = {};
      for (const k of cache.keys()) obj[k] = cache.get(k);
      fs.writeFileSync(filePath, JSON.stringify(obj));
    } catch (e) { /* storage full / read-only -> keep serving from cache */ }
  }
  load();

  store.get = function (sid, cb) {
    const s = cache.get(sid);
    if (!s) return cb(null, null);
    try { return cb(null, JSON.parse(JSON.stringify(s))); } catch (e) { return cb(null, null); }
  };
  store.set = function (sid, sess, cb) { cache.set(sid, sess); save(); return cb(null, sess); };
  store.destroy = function (sid, cb) { cache.delete(sid); save(); return cb(null, null); };
  store.touch = function (sid, sess, cb) { cache.set(sid, sess); save(); return cb(null, sess); };
  store.all = function (cb) { const out = {}; for (const k of cache.keys()) out[k] = JSON.parse(JSON.stringify(cache.get(k))); try { return cb(null, out); } catch (e) { return cb(e, null); } };

  return store;
}

module.exports = createSessionStore;
module.exports.createSessionStore = createSessionStore;
module.exports.Store = require('express-session').Store;
