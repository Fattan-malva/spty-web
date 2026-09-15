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
  var playerFrame = document.getElementById('playerFrame');

  if (!mini || !frame || !lyrics || !close) return;

  function readPlayback() {
    try {
      var value = JSON.parse(localStorage.getItem('spotifyPlayback') || 'null');
      return value && value.trackId ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writePlayback(value) {
    try {
      localStorage.setItem('spotifyPlayback', JSON.stringify(value));
    } catch (e) {}
  }

  function updateHeader(value) {
    if (!value) return;
    title.textContent = value.title || 'Sedang diputar';
    artist.textContent = value.artist || '';
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
    mini.classList.remove('streaming');
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
      playing: true
    };

    writePlayback(playback);

    if (playerFrame) {
      playerFrame.src = 'about:blank';
      playerFrame.hidden = true;
      playerFrame.classList.remove('is-background');
    }

    frame.dataset.trackId = playback.trackId;
    frame.src = frameUrl(playback.trackId);
    updateHeader(playback);
    mini.classList.remove('streaming');
    mini.hidden = false;
  }

  function goToFullPlayer() {
    var playback = readPlayback();
    if (!playback || !playback.trackId) return;

    /* Let the embedded player flush its latest playhead before navigation. */
    try {
      frame.contentWindow.postMessage({ type: 'flush-playback' }, location.origin);
    } catch (e) {}

    /* Keep the current track in storage; player.html will load it directly. */
    window.location.assign('/player?trackId=' + encodeURIComponent(playback.trackId));
  }

  function closeMini() {
    try {
      frame.contentWindow.postMessage({ type: 'player-stop' }, location.origin);
    } catch (e) {}
    frame.src = 'about:blank';
    frame.removeAttribute('data-track-id');
    mini.hidden = true;
    mini.classList.remove('streaming');
    try {
      localStorage.removeItem('spotifyPlayback');
    } catch (e) {}
  }

  function restore() {
    var playback = readPlayback();
    if (!playback || !playback.trackId) {
      mini.hidden = true;
      return;
    }
    showMini(playback, true);
  }

  /* Capture phase prevents the older search.js click handlers from opening the
     fullscreen playerFrame. There is now only one playback iframe. */
  document.addEventListener('click', function (event) {
    var queueButton = event.target.closest && event.target.closest('.queue-next');
    if (queueButton) return;

    var card = event.target.closest && event.target.closest('.card');
    if (card && card.dataset.id) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMini(card);
      return;
    }

    var suggestion = event.target.closest && event.target.closest('.suggestion-item');
    if (suggestion && suggestion.dataset.id) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMini(suggestion);
      return;
    }

    var remove = event.target.closest && event.target.closest('.queue-remove');
    if (remove) return;

    var queueRow = event.target.closest && event.target.closest('.queue-item');
    if (queueRow && queueRow.dataset.index != null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var queue;
      try { queue = JSON.parse(localStorage.getItem('spotifyQueue') || '[]'); } catch (e) { queue = []; }
      var item = queue[Number(queueRow.dataset.index)];
      if (item && item.trackId) {
        queue.splice(Number(queueRow.dataset.index), 1);
        localStorage.setItem('spotifyQueue', JSON.stringify(queue));
        openMini({
          dataset: {
            id: item.trackId,
            title: item.title || '',
            artist: item.artist || '',
            thumbnail: item.thumbnail || ''
          }
        });
        var panel = document.getElementById('queuePanel');
        if (panel) panel.hidden = true;
      }
      return;
    }

    if (event.target.closest && event.target.closest('#miniLyrics')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      goToFullPlayer();
      return;
    }

    if (event.target.closest && event.target.closest('#miniClose')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMini();
    }
  }, true);

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data) return;

    if (event.data.type === 'playback-state' && event.data.playback && event.data.playback.trackId) {
      writePlayback(event.data.playback);
      updateHeader(event.data.playback);
      mini.hidden = false;
      mini.classList.remove('streaming');
    }
  });

  window.addEventListener('pageshow', function () {
    setTimeout(restore, 0);
  });

  /* On a fresh search page load, restore immediately as well. */
  setTimeout(restore, 0);
})();
