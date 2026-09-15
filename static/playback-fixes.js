(function () {
  'use strict';

  var isSearch = document.body.classList.contains('page-search');
  var isPlayer = document.body.classList.contains('page-player');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function readQueue() {
    try {
      var q = JSON.parse(localStorage.getItem('spotifyQueue') || '[]');
      return Array.isArray(q) ? q : [];
    } catch (e) {
      return [];
    }
  }

  function readPlayback() {
    try { return JSON.parse(localStorage.getItem('spotifyPlayback') || 'null'); } catch (e) { return null; }
  }

  function ensureMiniArtwork() {
    var mini = document.getElementById('miniPlayer');
    var copy = document.querySelector('.mini-copy');
    if (!mini || !copy || document.getElementById('miniArtwork')) return;
    var img = document.createElement('img');
    img.id = 'miniArtwork';
    img.alt = '';
    img.width = 42;
    img.height = 42;
    img.style.cssText = 'width:42px;height:42px;object-fit:cover;border-radius:6px;background:#282828;display:none;flex:none';
    mini.insertBefore(img, copy);
    mini.style.gridTemplateColumns = '42px minmax(120px,1fr) 30px 30px';
  }

  function updateMiniArtwork(item) {
    var img = document.getElementById('miniArtwork');
    if (!img) return;
    var src = item && item.thumbnail ? item.thumbnail : '';
    if (!src) {
      img.removeAttribute('src');
      img.style.display = 'none';
      return;
    }
    img.src = src;
    img.style.display = 'block';
  }

  function decorateQueueItems() {
    var list = document.getElementById('queueList');
    if (!list) return;
    var queue = readQueue();
    var rows = list.querySelectorAll('.queue-item');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.querySelector('.queue-thumb')) continue;
      var item = queue[i];
      if (!item) continue;
      var img = document.createElement('img');
      img.className = 'queue-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.src = item.thumbnail || '';
      img.onerror = function () { this.style.visibility = 'hidden'; };
      row.insertBefore(img, row.firstChild);
    }
  }

  function startQueueObserver() {
    var list = document.getElementById('queueList');
    if (!list || !window.MutationObserver) return;
    new MutationObserver(function () {
      decorateQueueItems();
    }).observe(list, { childList: true, subtree: true });
    decorateQueueItems();
  }

  if (isSearch) {
    ensureMiniArtwork();
    startQueueObserver();

    function forceMiniVisible() {
      var saved = readPlayback();
      var mini = document.getElementById('miniPlayer');
      if (!mini || !saved || !saved.trackId || saved.playing !== true) return;
      var title = document.getElementById('miniTitle');
      var artist = document.getElementById('miniArtist');
      if (title) title.textContent = saved.title || 'Sedang diputar';
      if (artist) artist.textContent = saved.artist || '';
      updateMiniArtwork(saved);
      mini.classList.add('streaming');
      mini.hidden = false;
      if (typeof window.lucide !== 'undefined') window.lucide.createIcons();
    }

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'player-back' || e.data.type === 'playback-state') {
        setTimeout(forceMiniVisible, 0);
        setTimeout(forceMiniVisible, 120);
      }
    });

    window.addEventListener('popstate', function () {
      setTimeout(forceMiniVisible, 0);
      setTimeout(forceMiniVisible, 120);
    });

    window.addEventListener('pageshow', function () {
      setTimeout(forceMiniVisible, 0);
    });

    var queueBtn = document.getElementById('queueBtn');
    if (queueBtn) queueBtn.addEventListener('click', function () {
      setTimeout(decorateQueueItems, 0);
    });

    setInterval(function () {
      decorateQueueItems();
      forceMiniVisible();
    }, 1000);
  }

  if (isPlayer) {
    startQueueObserver();

    var frame = document.getElementById('spWidget');
    var lastHandledTrack = '';
    var lastEndedAt = 0;

    function advanceQueueFallback() {
      var queue = readQueue();
      if (!queue.length) return false;

      var saved = readPlayback();
      var currentTrack = saved && saved.trackId ? saved.trackId : '';
      var key = currentTrack + '|' + queue[0].trackId;
      var now = Date.now();
      if (key === lastHandledTrack && now - lastEndedAt < 5000) return false;
      lastHandledTrack = key;
      lastEndedAt = now;

      var next = queue.shift();
      localStorage.setItem('spotifyQueue', JSON.stringify(queue));
      localStorage.setItem('spotifyPlayback', JSON.stringify({
        trackId: next.trackId,
        title: next.title || '',
        artist: next.artist || '',
        thumbnail: next.thumbnail || '',
        positionMs: 0,
        playing: false
      }));

      var params = new URLSearchParams(location.search);
      var embedded = params.get('embedded') === '1';
      var url = '/player?trackId=' + encodeURIComponent(next.trackId) + (embedded ? '&embedded=1' : '');
      location.replace(url);
      return true;
    }

    function inspectEndedMedia() {
      if (!frame) return;
      var doc = null;
      try { doc = frame.contentDocument || null; } catch (e) { return; }
      if (!doc) return;
      var media = doc.querySelector('audio,video');
      if (!media) return;

      var ended = media.ended;
      if (!ended && isFinite(media.duration) && media.duration > 0) {
        ended = media.currentTime >= Math.max(0, media.duration - 0.35);
      }
      if (ended) advanceQueueFallback();
    }

    setInterval(inspectEndedMedia, 250);
    if (frame) frame.addEventListener('load', function () {
      setTimeout(inspectEndedMedia, 250);
    });

    var queueBtn = document.getElementById('queueBtn');
    if (queueBtn) queueBtn.addEventListener('click', function () {
      setTimeout(decorateQueueItems, 0);
    });
  }
})();