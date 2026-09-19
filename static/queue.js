window.SpotifyQueue = (function () {
  var queue = [];
  var listeners = [];
  var activeKey = '';
  var started = false;

  var STORAGE_PREFIX = 'spotifyQueue::';
  var MAX_ITEMS = 500;
  var MAX_STRING_LEN = 5000;

  // ---------- helpers ----------
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    if (!match) return '';
    var value = match[1];
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }

  // Key antrean diturunkan dari sp_dc yang sedang login, jadi tiap akun
  // mendapat antrean sendiri. Pengunjung tanpa login memakai key "default".
  function userKey() {
    var dc = getCookie('sp_dc');
    return STORAGE_PREFIX + (dc && dc.length >= 20 ? dc : 'default');
  }

  function parseItems(raw) {
    try {
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      var items = [];
      for (var i = 0; i < data.length; i++) {
        var entry = data[i];
        if (entry && typeof entry === 'object' && entry.trackId) {
          items.push({
            id: String(entry.id || ''),
            trackId: String(entry.trackId || ''),
            title: String(entry.title || ''),
            artist: String(entry.artist || ''),
            thumbnail: String(entry.thumbnail || '')
          });
        }
      }
      return items;
    } catch (err) {
      return [];
    }
  }

  function read() {
    var key = userKey();
    var raw = '';
    try { raw = localStorage.getItem(key) || ''; } catch (e) {}
    return { key: key, items: parseItems(raw) };
  }

  function write(items) {
    try {
      localStorage.setItem(activeKey, JSON.stringify(items.slice(0, MAX_ITEMS)));
    } catch (e) {}
  }

  // Reload dari localStorage bila key berubah (login/logout ganti sp_dc)
  // atau saat pertama kali dipakai.
  function ensureLoaded() {
    var data = read();
    if (data.key !== activeKey) {
      activeKey = data.key;
      queue = data.items;
    }
  }

  function emit() {
    listeners.forEach(function (cb) {
      try { cb(queue.slice(), queue.length); } catch (e) {}
    });
  }

  function subscribe(cb) {
    listeners.push(cb);
    cb(queue.slice(), queue.length);
    return function () {
      var i = listeners.indexOf(cb);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  // ---------- mutations (mirror app/queue_store.py) ----------
  function cleanItem(item) {
    if (!item || typeof item !== 'object') return null;
    var trackId = String(item.trackId || '').trim();
    if (!trackId) return null;
    function cap(v) { return String(v || '').slice(0, MAX_STRING_LEN); }
    return {
      trackId: trackId.slice(0, 200),
      title: cap(item.title),
      artist: cap(item.artist),
      thumbnail: cap(item.thumbnail)
    };
  }

  function genId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function actionAdd(items) {
    ensureLoaded();
    var batch = Array.isArray(items) ? items : [items];
    var added = 0;
    for (var i = 0; i < batch.length; i++) {
      var clean = cleanItem(batch[i]);
      if (!clean) continue;
      clean.id = genId();
      queue.push(clean);
      added += 1;
    }
    if (added === 0) return Promise.reject(new Error('Invalid queue item(s)'));
    queue = queue.slice(0, MAX_ITEMS);
    write(queue);
    emit();
    return Promise.resolve({ queue: queue.slice(), count: queue.length, added: added });
  }

  function actionRemove(index) {
    ensureLoaded();
    var idx = Number(index);
    if (isNaN(idx) || idx < 0 || idx >= queue.length) {
      return Promise.reject(new Error('Index out of range'));
    }
    var removed = queue[idx];
    queue.splice(idx, 1);
    write(queue);
    emit();
    return Promise.resolve({ queue: queue.slice(), count: queue.length, removed: removed, index: idx });
  }

  function actionShift() {
    ensureLoaded();
    var removed = queue.shift() || null;
    write(queue);
    emit();
    return Promise.resolve({ queue: queue.slice(), count: queue.length, shifted: removed });
  }

  function actionClear() {
    ensureLoaded();
    queue = [];
    write(queue);
    emit();
    return Promise.resolve({ queue: [], count: 0 });
  }

  // ---------- public API ----------
  function refresh() {
    ensureLoaded();
    emit();
    return Promise.resolve(queue.slice());
  }

  function start() {
    if (started) return;
    started = true;
    ensureLoaded();
    // Sinkronisasi antar-tab (pengganti SSE): storage event hanya muncul di
    // tab lain, jadi kita muat ulang dari localStorage untuk key pengguna ini.
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key.indexOf(STORAGE_PREFIX) !== 0) return;
      if (e.key !== userKey()) return;
      queue = parseItems(e.newValue || '');
      activeKey = e.key;
      emit();
    });
  }

  return {
    get: function () { ensureLoaded(); return queue.slice(); },
    refresh: refresh,
    add: function (item) { return actionAdd(item); },
    addMany: function (items) { return actionAdd(items); },
    remove: function (index) { return actionRemove(index); },
    shift: function () { return actionShift(); },
    clear: function () { return actionClear(); },
    subscribe: subscribe,
    start: start
  };
})();