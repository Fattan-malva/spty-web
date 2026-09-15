(function () {
  'use strict';

  function getMedia() {
    var frame = document.getElementById('spWidget');
    if (!frame) return null;
    try {
      var doc = frame.contentDocument;
      return doc && doc.querySelector('audio,video');
    } catch (e) { return null; }
  }

  function stopPlayback() {
    var media = getMedia();
    if (media) {
      try { media.pause(); media.currentTime = media.currentTime; } catch (e) {}
    }
    try {
      localStorage.removeItem('spotifyPlayback');
    } catch (e) {}
  }

  function restorePlayback(playback) {
    if (!playback) return;
    var tries = 0;
    function attempt() {
      var media = getMedia();
      if (!media && tries++ < 12) {
        setTimeout(attempt, 300);
        return;
      }
      if (!media) return;
      try {
        if (typeof playback.positionMs === 'number' && playback.positionMs > 0) {
          media.currentTime = playback.positionMs / 1000;
        }
        if (playback.playing === true) {
          var p = media.play();
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) {}
    }
    attempt();
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'stop-playback') {
      stopPlayback();
    } else if (e.data.type === 'restore-playback') {
      restorePlayback(e.data.playback);
    }
  });
})();
