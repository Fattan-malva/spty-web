(function () {
  'use strict';
  var isSearch = document.body.classList.contains('page-search');
  var isPlayer = document.body.classList.contains('page-player');

  function readQueue() {
    try { var q = JSON.parse(localStorage.getItem('spotifyQueue') || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; }
  }
  function readPlayback() { try { return JSON.parse(localStorage.getItem('spotifyPlayback') || 'null'); } catch (e) { return null; } }

  function injectStyles() {
    if (document.getElementById('playback-fixes-style')) return;
    var s = document.createElement('style'); s.id = 'playback-fixes-style';
    s.textContent = '.mini-player{grid-template-columns:42px minmax(0,1fr) 30px 30px!important;width:min(380px,calc(100vw - 32px))!important;right:16px!important;bottom:16px!important;padding:8px!important;min-height:58px}.mini-player.streaming iframe{display:none!important}.mini-artwork{width:42px!important;height:42px!important;border-radius:6px!important;object-fit:cover!important;background:#282828;flex:none;display:block}.queue-thumb{width:36px!important;height:36px!important;min-width:36px!important;border-radius:4px!important;object-fit:cover!important;background:#282828;flex:none}';
    document.head.appendChild(s);
  }

  function ensureMiniArtwork() {
    var mini = document.getElementById('miniPlayer'), copy = document.querySelector('.mini-copy');
    if (!mini || !copy || document.getElementById('miniArtwork')) return;
    var img = document.createElement('img'); img.id = 'miniArtwork'; img.className = 'mini-artwork'; img.alt = ''; img.hidden = true; mini.insertBefore(img, copy);
  }
  function updateMiniArtwork(item) {
    var img = document.getElementById('miniArtwork'); if (!img) return;
    if (!item || !item.thumbnail) { img.hidden = true; img.removeAttribute('src'); return; }
    img.src = item.thumbnail; img.hidden = false;
  }
  function decorateQueueItems() {
    var list = document.getElementById('queueList'); if (!list) return;
    var queue = readQueue(), rows = list.querySelectorAll('.queue-item');
    for (var i = 0; i < rows.length; i++) {
      var item = queue[i], row = rows[i]; if (!item) continue;
      var old = row.querySelector('.queue-thumb');
      if (old) { if (item.thumbnail && old.src !== item.thumbnail) old.src = item.thumbnail; continue; }
      var img = document.createElement('img'); img.className = 'queue-thumb'; img.alt = ''; img.loading = 'lazy'; if (item.thumbnail) img.src = item.thumbnail;
      img.onerror = function () { this.style.visibility = 'hidden'; }; row.insertBefore(img, row.firstChild);
    }
  }
  function startQueueObserver() {
    var list = document.getElementById('queueList'); if (!list || !window.MutationObserver) return;
    new MutationObserver(decorateQueueItems).observe(list, { childList: true, subtree: true }); decorateQueueItems();
  }

  if (isSearch) {
    injectStyles(); ensureMiniArtwork(); startQueueObserver();
    var mini = document.getElementById('miniPlayer');
    var miniLyrics = document.getElementById('miniLyrics');
    var miniClose = document.getElementById('miniClose');

    function forceMiniVisible() {
      var saved = readPlayback(); if (!mini || !saved || !saved.trackId || saved.playing !== true) return;
      var title = document.getElementById('miniTitle'), artist = document.getElementById('miniArtist');
      if (title) title.textContent = saved.title || 'Sedang diputar';
      if (artist) artist.textContent = saved.artist || '';
      updateMiniArtwork(saved); mini.classList.add('streaming'); mini.hidden = false;
      if (window.lucide) window.lucide.createIcons();
    }

    function openLyrics() {
      var saved = readPlayback();
      if (!saved || !saved.trackId) return;
      var frame = document.getElementById('playerFrame');
      if (!frame) return;
      // Re-open the same track in the embedded player so the lyrics page follows the current song.
      frame.src = '/player?trackId=' + encodeURIComponent(saved.trackId) + '&embedded=1';
      frame.hidden = false;
      frame.classList.remove('is-background');
      mini.hidden = true;
      setTimeout(function () {
        try { frame.contentWindow.postMessage({ type: 'restore-playback', playback: saved }, location.origin); } catch (e) {}
      }, 600);
    }

    function closeMini() {
      var frame = document.getElementById('playerFrame');
      if (frame) {
        try { frame.contentWindow.postMessage({ type: 'stop-playback' }, location.origin); } catch (e) {}
        frame.src = 'about:blank'; frame.hidden = true; frame.classList.remove('is-background');
      }
      var miniFrame = document.getElementById('miniFrame'); if (miniFrame) miniFrame.src = 'about:blank';
      if (mini) { mini.hidden = true; mini.classList.remove('streaming'); }
      localStorage.removeItem('spotifyPlayback');
    }

    if (miniLyrics) miniLyrics.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openLyrics(); });
    if (miniClose) miniClose.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeMini(); });

    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'player-back' || e.data.type === 'playback-state') {
        if (e.data.playback && e.data.playback.trackId) localStorage.setItem('spotifyPlayback', JSON.stringify(e.data.playback));
        setTimeout(forceMiniVisible, 0); setTimeout(forceMiniVisible, 120);
      }
    }, true);
    window.addEventListener('popstate', function () { setTimeout(forceMiniVisible, 0); setTimeout(forceMiniVisible, 120); });
    window.addEventListener('pageshow', function () { setTimeout(forceMiniVisible, 0); });
    var queueBtn = document.getElementById('queueBtn'); if (queueBtn) queueBtn.addEventListener('click', function () { setTimeout(decorateQueueItems, 0); });
    setInterval(function () { decorateQueueItems(); forceMiniVisible(); }, 250);
  }

  // Never render a mini player on the standalone player page.
  if (isPlayer) {
    injectStyles(); startQueueObserver();
    var frame = document.getElementById('spWidget'), lastHandledTrack = '', lastEndedAt = 0;
    function advanceQueueFallback() {
      var queue = readQueue(); if (!queue.length) return false;
      var saved = readPlayback(), current = saved && saved.trackId ? saved.trackId : '', key = current + '|' + queue[0].trackId, now = Date.now();
      if (key === lastHandledTrack && now - lastEndedAt < 5000) return false;
      lastHandledTrack = key; lastEndedAt = now;
      var next = queue.shift(); localStorage.setItem('spotifyQueue', JSON.stringify(queue));
      localStorage.setItem('spotifyPlayback', JSON.stringify({ trackId: next.trackId, title: next.title || '', artist: next.artist || '', thumbnail: next.thumbnail || '', positionMs: 0, playing: false }));
      var params = new URLSearchParams(location.search), url = '/player?trackId=' + encodeURIComponent(next.trackId) + (params.get('embedded') === '1' ? '&embedded=1' : '');
      location.replace(url); return true;
    }
    function inspectEndedMedia() {
      if (!frame) return; var doc = null; try { doc = frame.contentDocument || null; } catch (e) { return; }
      if (!doc) return; var media = doc.querySelector('audio,video'); if (!media) return;
      var ended = media.ended; if (!ended && isFinite(media.duration) && media.duration > 0) ended = media.currentTime >= Math.max(0, media.duration - 0.35);
      if (ended) advanceQueueFallback();
    }
    setInterval(inspectEndedMedia, 250); if (frame) frame.addEventListener('load', function () { setTimeout(inspectEndedMedia, 250); });
  }
})();