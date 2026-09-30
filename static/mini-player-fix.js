(function () {
  'use strict';

  if (window.__miniPlayerFixLoaded) return;
  window.__miniPlayerFixLoaded = true;

  // Mini player di home sekarang hanya berisi <iframe> embed Spotify: tidak ada
  // judul, tombol ▶, tombol tutup, maupun tombol lirik lagi. Semua elemen
  // di bawah opsional supaya file ini tidak error kalau markup-nya berubah.
  var mini = document.getElementById('miniPlayer');
  var frame = document.getElementById('miniFrame');
  var title = document.getElementById('miniTitle');
  var barTitle = document.getElementById('miniBarTitle');
  var artist = document.getElementById('miniArtist');
  var artwork = document.getElementById('miniArtwork');
  var lyrics = document.getElementById('miniLyrics');
  var close = document.getElementById('miniClose');

  if (!mini || !frame) return;

  var floatQueueBtn = document.getElementById('floatQueueBtn');
  var floatQueueCount = document.getElementById('floatQueueCount');
  var floatLyricBtn = document.getElementById('floatLyricBtn');
  var floatQueuePanel = document.getElementById('floatQueuePanel');
  var floatQueueList = document.getElementById('floatQueueList');
  var floatQueueEmpty = document.getElementById('floatQueueEmpty');
  var floatQueueCount2 = document.getElementById('floatQueueCount2');
  var floatQueueClear = document.getElementById('floatQueueClear');
  var floatQueueClose = document.getElementById('floatQueueClose');

  // ---------- Autoplay: buka izin media di dalam gesture asli ----------
  // iOS/Safari hanya mengizinkan autoplay pada dokumen yang sudah pernah
  // mendapat user gesture. Jadi izin itu dibuka SEKALI, sinkron, di dalam
  // tap pengguna yang sebenarnya - bukan lewat setTimeout setelahnya, karena
  // activation sudah hilang kalau menunggu.
  //
  // WAV senyap 0,12 detik: hanya "kunci" izin, volumenya 0 dan muted
  //  jadi tidak ada suara apa pun yang keluar.
  var SILENT_WAV = 'data:audio/wav;base64,UklGRqQHAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  var homePrimed = false;

  function primeHomeMedia() {
    if (homePrimed) return;
    homePrimed = true;
    try {
      var a = new Audio();
      a.src = SILENT_WAV;
      a.preload = 'auto';
      a.volume = 0;
      a.muted = true;
      a.addEventListener('playing', function () {
        a.muted = true;
        a.volume = 0;
        a.pause();
        a.currentTime = 0;
      }, { once: true });
      var p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          a.muted = true;
          a.volume = 0;
          a.pause();
          a.currentTime = 0;
        }).catch(function () {});
      }
    } catch (e) {}
  }

  // Dipanggil dari dalam handler klik kartu. Frame /player bersifat
  // same-origin, jadi user activation ikut terbawa ke dokumen itu.
  function forwardGestureToPlayer() {
    primeHomeMedia();
    try {
      var w = frame.contentWindow;
      if (!w) return;
      if (typeof w.sptPrimeMedia === 'function') w.sptPrimeMedia();
      if (typeof w.sptGesturePlay === 'function') w.sptGesturePlay();
    } catch (e) {}
  }

  // Gesture pertama di halaman ini saja perlu membuka izin di dokumen
  // home, setelah itu tidak perlu diulang.
  if (!window.__mediaGestureArmed) {
    window.__mediaGestureArmed = true;
    ['touchend', 'mousedown', 'click', 'keydown'].forEach(function (type) {
      document.addEventListener(type, primeHomeMedia, {
        capture: true,
        passive: true,
        once: true
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Panel antrean floating ----------
  // Sama seperti panel antrean di halaman lirik: klik judul untuk memutar
  // sekarang, klik ✕ untuk menghapus satu item.
  function renderFloatQueue() {
    if (!floatQueueList) return;
    var queue = window.SpotifyQueue ? window.SpotifyQueue.get() : [];
    if (floatQueueEmpty) floatQueueEmpty.hidden = queue.length > 0;
    if (floatQueueCount2) floatQueueCount2.textContent = queue.length;
    if (floatQueueCount) {
      floatQueueCount.textContent = queue.length;
      floatQueueCount.hidden = queue.length === 0;
    }
    floatQueueList.innerHTML = '';
    queue.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'float-queue-item';
      row.dataset.index = index;
      row.dataset.trackId = item.trackId || '';
      row.title = 'Putar sekarang';
      row.innerHTML =
        (item.thumbnail
          ? '<img class="float-queue-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="">'
          : '<span class="float-queue-thumb float-queue-thumb-empty"><i data-lucide="music"></i></span>') +
        '<span class="float-queue-copy"><strong>' + escapeHtml(item.title || 'Unknown') +
        '</strong><small>' + escapeHtml(item.artist || '') + '</small></span>' +
        '<button class="float-queue-remove" data-index="' + index +
        '" title="Hapus dari antrean" aria-label="Hapus dari antrean">' +
        '<i data-lucide="x"></i></button>';
      floatQueueList.appendChild(row);
    });
    refreshIcons();
  }

  // Ikon pakai lucide (bukan Font Awesome) karena FA free tidak punya
  // fa-list-music / fa-microphone-lines - itu ikon Pro, makanya ikon lama
  // hanya muncul sebagai lingkaran kosong.
  function refreshIcons() {
    try { if (window.lucide) window.lucide.createIcons(); } catch (e) {}
  }

  function setFloatQueueOpen(open) {
    if (!floatQueuePanel) return;
    if (open) renderFloatQueue();
    floatQueuePanel.hidden = !open;
  }

  // Sesi pemutaran yang sedang aktif di dalam iframe /player.
  var session = null;
  var isPlaying = false;
  // Sesi dianggap masih hidup walau `playing` belum true. Di iOS Safari
  // autoplay bisa terlambat, jadi `playing` tidak boleh dipakai sebagai syarat
  // menampilkan mini player: kalau disembunyikan terlalu cepat, tidak ada lagi
  // jalur untuk memulai pemutaran dan lagunya tidak akan pernah berbunyi.
  var SESSION_TTL = 12 * 60 * 60 * 1000;


  function readPlayback() {
    try {
      var value = JSON.parse(localStorage.getItem('spotifyPlayback') || 'null');
      return value && value.trackId ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writePlayback(value) {
    try { localStorage.setItem('spotifyPlayback', JSON.stringify(value)); } catch (e) {}
  }

  function clearPlayback() {
    try { localStorage.removeItem('spotifyPlayback'); } catch (e) {}
  }

  function toast(msg, ms) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('show');
    clearTimeout(box._t);
    box._t = setTimeout(function () { box.classList.remove('show'); }, ms || 2600);
  }

  function updateHeader(value) {
    if (!value) return;
    var label = value.title || 'Sedang diputar';
    if (title) title.textContent = label;
    if (barTitle) barTitle.textContent = label;
    if (artist) artist.textContent = value.artist || '';
    if (artwork) {
      artwork.src = value.thumbnail || '';
      artwork.hidden = !value.thumbnail;
    }
  }

  // Bar mini player menempel flush di dasar layar (152px), jadi saat tampil
  // konten home harus diberi ruang bawah. Class ini yang dibaca
  // CSS-nya lewat `html.has-mini-player .app-grid`.
  function setMiniHidden(hidden) {
    mini.hidden = !!hidden;
    try {
      document.documentElement.classList.toggle('has-mini-player', !hidden);
    } catch (e) {}
    syncFloatingChrome();
  }

  function frameUrl(trackId) {
    return '/player?trackId=' + encodeURIComponent(trackId) + '&embedded=1&mini=1';
  }

  // Tampilkan mini player. Tidak pernah menyembunyikan frame yang sedang
  // memutar: di iOS Safari iframe di dalam display:none bisa dibongkar.
  function showMini(value, reloadFrame) {
    if (!value || !value.trackId) return;
    updateHeader(value);
    collapseToStreaming(value.trackId);
    setMiniHidden(false);
    if (reloadFrame !== false && frame.dataset.trackId !== value.trackId) {
      frame.dataset.trackId = value.trackId;
      frame.src = frameUrl(value.trackId);
    }
  }

  // Kembali ke tampilan mini kecil. Kalau view lirik sedang terbuka untuk
  // lagu yang sama, biarkan saja: laporan status dari dokumen /player dikirim
  // tiap ~1 detik dan itulah yang membuat view lirik ikut tertutup sendiri.
  function collapseToStreaming(keepTrackId) {
    if (mini.classList.contains('expanded') && keepTrackId && session &&
        session.trackId === keepTrackId) {
      return false;
    }
    mini.classList.remove('expanded');
    mini.classList.add('streaming');
    syncFloatingChrome();
    return true;
  }

  // Jaring pengaman tampilan: dokumen /player melaporkan tampilan yang sedang
  // aktif. Kalau parent dan iframe tidak sepakat, salah satu langsung
  // disinkronkan supaya lirik tidak pernah tertinggal di mini player.
  function syncViewWithPlayer(view) {
    if (!view || !session || !session.trackId) return;
    var wantLyrics = view === 'lyrics';
    var haveLyrics = mini.classList.contains('expanded');
    if (wantLyrics === haveLyrics) return;
    if (wantLyrics) expandForLyrics();
    else collapseLyrics();
  }

  function startSession(value) {
    session = value;
    isPlaying = value.playing === true;
    showMini(value, true);
  }

  // Tutup sesi dan kosongkan frame. Dipakai hanya untuk aksi pengguna
  // (tombol tutup) atau ketika tidak ada sesi sama sekali.
  function hideMini(destroyFrame) {
    session = null;
    isPlaying = false;
    setMiniHidden(true);
    mini.classList.remove('streaming', 'expanded');
    if (destroyFrame && frame.dataset.trackId) {
      try { frame.contentWindow.postMessage({ type: 'player-stop' }, location.origin); } catch (e) {}
      frame.removeAttribute('data-track-id');
      frame.src = 'about:blank';
    }
    clearPlayback();
  }

  function openMini(source) {
    if (!source || !source.dataset || !source.dataset.id) return;
    // Semua ini masih di dalam user gesture: teruskan ke dokumen /player
    // supaya play() punya izin (lihat forwardGestureToPlayer).
    forwardGestureToPlayer();
    setFloatQueueOpen(false);
    var playback = {
      trackId: source.dataset.id,
      title: source.dataset.title || '',
      artist: source.dataset.artist || '',
      thumbnail: source.dataset.thumbnail || '',
      positionMs: 0,
      playing: true,
      lastActiveAt: Date.now()
    };
    writePlayback(playback);
    // Kalau dokumen /player masih hidup, jangan set src: memuat ulang iframe
    // yang sedang membunyikan audio adalah penyebab paling sering audio mati
    // di iOS. Minta dokumen itu saja yang berganti lagu.
    if (playerFrameAlive()) {
      session = playback;
      isPlaying = false;
      updateHeader(playback);
      collapseToStreaming(playback.trackId);
      setMiniHidden(false);
      try {
        frame.contentWindow.postMessage({
          type: 'set-track',
          trackId: playback.trackId,
          title: playback.title,
          artist: playback.artist,
          thumbnail: playback.thumbnail
        }, location.origin);
      } catch (e) {}
      return;
    }
    startSession(playback);
  }

  // True kalau iframe /player sudah selesai dimuat (bukan about:blank kosong).
  function playerFrameAlive() {
    try {
      var doc = frame.contentDocument;
      return !!(doc && doc.getElementById('spWidget'));
    } catch (e) {
      return false;
    }
  }

  // Halaman lirik layar penuh sudah punya tombolnya sendiri, jadi dua tombol
  // floating ini disembunyikan selama tampilan itu terbuka.
  function syncFloatingChrome() {
    var lyricsOpen = mini.classList.contains('expanded');
    try {
      document.documentElement.classList.toggle('lyrics-open', lyricsOpen);
    } catch (e) {}
  }

  function expandForLyrics() {
    if (!session || !session.trackId) return;
    var playback = session;
    mini.classList.add('expanded');
    mini.classList.remove('streaming');
    syncFloatingChrome();
    setMiniHidden(false);
    try {
      frame.contentWindow.postMessage({ type: 'expand-lyrics-view', playback: playback }, location.origin);
    } catch (e) {}
  }

  // Penting: URL halaman tidak pernah diubah ke /player saat lirik dibuka.
  // Begitu URL berubah, halaman yang di-reload (iOS meng-evict halaman saat
  // memori penuh, atau user pull-to-refresh) akan memuat player.html sebagai
  // halaman biasa, dan tombol kembali-nya selalu melempar user ke '/'.
  // Expanded view karena itu ditutup lewat tombol, bukan lewat tombol back.
  function collapseLyrics() {
    mini.classList.remove('expanded');
    mini.classList.add('streaming');
    syncFloatingChrome();
    setMiniHidden(false);
    try { frame.contentWindow.postMessage({ type: 'collapse-mini-view' }, location.origin); } catch (e) {}
  }

  function closeMini() {
    collapseLyrics();
    hideMini(true);
  }

  function restore() {
    var playback = readPlayback();
    var age = playback ? Date.now() - (playback.lastActiveAt || 0) : Infinity;
    if (!playback || !playback.trackId || age > SESSION_TTL) {
      hideMini(true);
      return;
    }
    startSession(playback);
    // Minta dokumen pemutar melanjutkan pemutaran yang sempat jalan.
    requestPlay();
  }

  // ---------- Satu-satunya cara memulai pemutaran ----------
  //
  // Dulu file ini punya jalurnya sendiri: mencari elemen audio/video di dalam
  // dokumen embed, lalu mengklik tombol play-nya sendiri. Dua jalur autoplay
  // dalam satu halaman berarti satu klik ekstra, dan karena tombol play/pause
  // itu TOGGLE, klik kedua justru MENJEDA lagu yang baru saja berjalan.
  //
  // Sekarang pemicuannya satu saja: suruh dokumen /player yang mengklik
  // (sptGesturePlay / gesture-play). Satu-satunya tempat yang menyentuh
  // tombol embed adalah player.js, dan itu pun hanya sekali per lagu.
  function requestPlay() {
    try { frame.contentWindow.postMessage({ type: 'gesture-play' }, location.origin); } catch (e) {}
  }

  function syncFloatQueue() {
    if (floatQueueCount || floatQueueCount2) renderFloatQueue();
    if (floatQueueBtn) floatQueueBtn.hidden = false;
    if (floatQueuePanel && !floatQueuePanel.hidden) renderFloatQueue();
  }
  setInterval(syncFloatQueue, 2000);

  // Floating queue button: toggle panel antrean di sidebar kanan
  if (floatQueueBtn) {
    floatQueueBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFloatQueueOpen(!floatQueuePanel || floatQueuePanel.hidden);
    });
  }

  if (floatQueueClose) {
    floatQueueClose.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFloatQueueOpen(false);
    });
  }

  if (floatQueueClear) {
    floatQueueClear.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!window.SpotifyQueue) return;
      var count = window.SpotifyQueue.get().length;
      window.SpotifyQueue.clear()
        .then(function () {
          renderFloatQueue();
          toast('Antrean dikosongkan (' + count + ' lagu)');
        })
        .catch(function () {});
    });
  }

  // Klik item antrean: putar sekarang (dengan menghapus itemnya dari antrean
  // lewat shift(), sama seperti playNextQueued di dokumen /player).
  if (floatQueueList) {
    floatQueueList.addEventListener('click', function (event) {
      var target = event.target;
      var closest = target && target.closest ? target.closest.bind(target) : null;
      if (!closest) return;

      var remove = closest('.float-queue-remove');
      if (remove) {
        event.preventDefault();
        event.stopImmediatePropagation();
        var delIndex = Number(remove.dataset.index);
        if (isNaN(delIndex) || !window.SpotifyQueue) return;
        window.SpotifyQueue.remove(delIndex)
          .then(renderFloatQueue)
          .catch(function () {});
        return;
      }

      var row = closest('.float-queue-item');
      if (row && row.dataset.trackId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        var queue = window.SpotifyQueue ? window.SpotifyQueue.get() : [];
        var picked = null;
        for (var i = 0; i < queue.length; i++) {
          if (queue[i].trackId === row.dataset.trackId) { picked = queue[i]; break; }
        }
        if (!picked) return;
        setFloatQueueOpen(false);
        openMini({ dataset: {
          id: picked.trackId,
          title: picked.title || '',
          artist: picked.artist || '',
          thumbnail: picked.thumbnail || ''
        }});
      }
    });
  }

  // Tombol mikrofon: hanya tampil untuk lagu berlirik tersinkron, dan
  // kliknya membuka tampilan lirik layar penuh.
  if (floatLyricBtn) {
    floatLyricBtn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!session || !session.trackId) return;
      if (!mini.classList.contains('expanded')) expandForLyrics();
    });
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !floatQueuePanel || floatQueuePanel.hidden) return;
    var closest = target.closest ? target.closest.bind(target) : null;
    if (!closest) return;
    if (closest('#floatQueuePanel') || closest('#floatQueueBtn')) return;
    setFloatQueueOpen(false);
  }, true);

  document.addEventListener('click', function (event) {
    var target = event.target;
    var closest = target && target.closest ? target.closest.bind(target) : null;
    if (!closest) return;

    var queueButton = closest('.queue-next');
    if (queueButton) return;

    var card = closest('.card');
    if (card && card.dataset.id) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMini(card);
      return;
    }

    var suggestion = closest('.suggestion-item');
    if (suggestion && suggestion.dataset.id) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMini(suggestion);
      return;
    }

    var remove = closest('.queue-remove');
    if (remove) return;

    var queueRow = closest('.queue-item');
    if (queueRow && queueRow.dataset.index != null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var index = Number(queueRow.dataset.index);
      var item = null;
      try { item = (window.SpotifyQueue ? window.SpotifyQueue.get() : [])[index]; } catch (e) { item = null; }
      if (item && item.trackId) {
        (window.SpotifyQueue ? window.SpotifyQueue.remove(index) : Promise.reject())
          .then(function () {
            openMini({ dataset: { id: item.trackId, title: item.title || '', artist: item.artist || '', thumbnail: item.thumbnail || '' } });
            var panel = document.getElementById('queuePanel');
            if (panel) panel.hidden = true;
          })
          .catch(function () {});
      }
      return;
    }

    if (closest('#miniCollapse')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      collapseLyrics();
      return;
    }

    if (closest('#miniLyrics')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      expandForLyrics();
      return;
    }

    if (closest('#miniClose')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMini();
    }
  }, true);

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data) return;

    if (event.data.type === 'playback-state' && event.data.playback && event.data.playback.trackId) {
      syncFloatQueue();
      var playback = event.data.playback;
      playback.lastActiveAt = Date.now();
      writePlayback(playback);
      isPlaying = playback.playing === true;

      if (!session || session.trackId !== playback.trackId) {
        // Mini player dibuka dari luar (mis. restore / navigasi): ikuti frame.
        startSession(playback);
      } else {
        // Status berubah (main/jeda) atau lagu berganti: mini player tetap
        // terlihat. Jangan pernah menutup diri karena playing belum true, dan
        // jangan pernah menutup view lirik yang sedang dibuka.
        session = playback;
        updateHeader(playback);
        collapseToStreaming(playback.trackId);
        setMiniHidden(false);
      }
      syncViewWithPlayer(event.data.view);
      // Tombol mikrofon hanya untuk lagu yang liriknya ada DAN tersinkron.
      if (floatLyricBtn) {
        floatLyricBtn.hidden = !(event.data.hasSyncedLyrics === true);
      }
      return;
    }

    if (event.data.type === 'collapse-mini-request') {
      collapseLyrics();
      return;
    }

    // Lagu selesai dan antrean kosong: berhenti, tutup mini player.
    if (event.data.type === 'player-ended') {
      hideMini(true);
      return;
    }

    // Lagu selesai tapi antrean masih ada: lanjutkan ke lagu berikutnya tanpa
    // menutup mini player.
    if (event.data.type === 'track-changing') {
      // Lagu berikutnya masih diputar di iframe yang sama; view lirik (kalau
      // sedang terbuka) dibiarkan tetap terbuka.
      if (session) {
        collapseToStreaming(session.trackId);
        setMiniHidden(false);
      }
      return;
    }

    if (event.data.type === 'player-error') {
      showMini(session || { trackId: (session && session.trackId) || '', title: 'Gagal memuat player' }, false);
      toast(event.data.message || 'Gagal memuat player Spotify', 3200);
    }
  });

  window.addEventListener('pageshow', function () { setTimeout(restore, 0); });

  // iOS sering suspending iframe saat tab tidak aktif; saat kembali ke aplikasi
  // pastikan frame masih hidup dan pemutaran dilanjutkan.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!session || !session.trackId) return;
    var playerDoc = null;
    try { playerDoc = frame.contentDocument; } catch (e) {}
    if (!playerDoc || !playerDoc.body) {
      showMini(session, true);
    }
    if (isPlaying) requestPlay();
  });

  refreshIcons();
  setTimeout(restore, 0);
})();
