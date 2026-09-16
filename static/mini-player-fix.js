(function () {
  'use strict';

  if (window.__miniPlayerFixLoaded) return;
  window.__miniPlayerFixLoaded = true;

  var mini = document.getElementById('miniPlayer');
  var frame = document.getElementById('miniFrame');
  var title = document.getElementById('miniTitle');
  var artist = document.getElementById('miniArtist');
  var artwork = document.getElementById('miniArtwork');
  var lyrics = document.getElementById('miniLyrics');
  var close = document.getElementById('miniClose');

  if (!mini || !frame || !lyrics || !close) return;

  var falseStreak = 0;

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

  function updateHeader(value) {
    if (!value) return;
    if (title) title.textContent = value.title || 'Sedang diputar';
    if (artist) artist.textContent = value.artist || '';
    if (artwork) {
      artwork.src = value.thumbnail || '';
      artwork.hidden = !value.thumbnail;
    }
  }

  function frameUrl(trackId) {
    return '/player?trackId=' + encodeURIComponent(trackId) + '&embedded=1&mini=1';
  }

  function showMini(value, reloadFrame) {
    if (!value || !value.trackId) return;
    updateHeader(value);
    mini.classList.remove('expanded');
    mini.classList.add('streaming');
    mini.hidden = false;
    if (reloadFrame && frame.dataset.trackId !== value.trackId) {
      frame.dataset.trackId = value.trackId;
      frame.src = frameUrl(value.trackId);
    }
  }

  function openMini(source) {
    if (!source || !source.dataset || !source.dataset.id) return;
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
    frame.dataset.trackId = playback.trackId;
    frame.src = frameUrl(playback.trackId);
    updateHeader(playback);
    mini.classList.remove('expanded');
    mini.classList.add('streaming');
    mini.hidden = false;
  }

  function expandForLyrics() {
    var playback = readPlayback();
    if (!playback || !playback.trackId) return;
    mini.classList.add('expanded');
    mini.classList.remove('streaming');
    mini.hidden = false;
    try {
      frame.contentWindow.postMessage({ type: 'expand-lyrics-view', playback: playback }, location.origin);
    } catch (e) {}
    history.pushState({ miniLyrics: true }, '', '/player?trackId=' + encodeURIComponent(playback.trackId));
  }

  function collapseLyrics(updateHistory) {
    mini.classList.remove('expanded');
    mini.classList.add('streaming');
    mini.hidden = false;
    try { frame.contentWindow.postMessage({ type: 'collapse-mini-view' }, location.origin); } catch (e) {}
    if (updateHistory && location.pathname === '/player') history.back();
  }

  function closeMini() {
    try { frame.contentWindow.postMessage({ type: 'player-stop' }, location.origin); } catch (e) {}
    frame.src = 'about:blank';
    frame.removeAttribute('data-track-id');
    mini.hidden = true;
    mini.classList.remove('streaming', 'expanded');
    try { localStorage.removeItem('spotifyPlayback'); } catch (e) {}
    if (location.pathname === '/player') history.replaceState(null, '', '/');
  }

  function restore() {
    var playback = readPlayback();
    // Mini player hanya muncul saat ada sesi pemutaran yang baru saja aktif.
    if (!playback || !playback.trackId || playback.playing !== true) {
      frame.src = 'about:blank';
      frame.removeAttribute('data-track-id');
      mini.hidden = true;
      mini.classList.remove('streaming', 'expanded');
      return;
    }
    var age = Date.now() - (playback.lastActiveAt || 0);
    if (age > 120000) {
      frame.src = 'about:blank';
      frame.removeAttribute('data-track-id');
      mini.hidden = true;
      mini.classList.remove('streaming', 'expanded');
      return;
    }
    showMini(playback, true);
  }

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
      var playback = event.data.playback;
      playback.lastActiveAt = Date.now();
      writePlayback(playback);

      if (playback.playing === true) {
        // Sedang diputar: tampilkan dan pertahankan tanpa jeda.
        falseStreak = 0;
        updateHeader(playback);
        mini.hidden = false;
        if (!mini.classList.contains('expanded')) mini.classList.add('streaming');
        return;
      }

      // Flag playing bisa sempat false saat embed baru dimuat / buffer.
      // Tunggu beberapa detik berturut-turut non-playing sebelum menyembunyikan
      // mini player. Frame tidak pernah di-blank di sini agar pemutaran jalan.
      falseStreak++;
      if (falseStreak >= 12) {
        falseStreak = 0;
        mini.hidden = true;
        mini.classList.remove('streaming');
      }
      return;
    }

    if (event.data.type === 'collapse-mini-request') {
      collapseLyrics(false);
      if (location.pathname === '/player') history.back();
    }
  });

  window.addEventListener('popstate', function () {
    if (mini.classList.contains('expanded')) collapseLyrics(false);
  });

  window.addEventListener('pageshow', function () { setTimeout(restore, 0); });
  setTimeout(restore, 0);
})();