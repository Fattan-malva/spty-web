(function () {
  'use strict';

  var lastMedia = null;
  var endedTriggered = false;
  var lastTrackSignature = '';

  function getFrame() {
    return document.getElementById('spWidget');
  }

  function getTrackId() {
    try { return new URLSearchParams(location.search).get('trackId') || ''; } catch (e) { return ''; }
  }

  function getMediaFromDoc(doc, depth) {
    if (!doc || depth > 4) return null;
    try {
      var media = doc.querySelector('audio,video');
      if (media) return media;

      var frames = doc.querySelectorAll('iframe,frame');
      for (var i = 0; i < frames.length; i++) {
        try {
          var childDoc = frames[i].contentDocument;
          var childMedia = getMediaFromDoc(childDoc, depth + 1);
          if (childMedia) return childMedia;
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  function getMedia() {
    var frame = getFrame();
    if (!frame) return null;
    try {
      return getMediaFromDoc(frame.contentDocument, 0);
    } catch (e) {
      return null;
    }
  }

  function stopPlayback() {
    var media = getMedia();
    if (media) {
      try { media.pause(); media.currentTime = media.currentTime; } catch (e) {}
    }
    try { localStorage.removeItem('spotifyPlayback'); } catch (e) {}
  }

  function restorePlayback(playback) {
    if (!playback) return;
    var tries = 0;
    function attempt() {
      var media = getMedia();
      if (!media && tries++ < 16) {
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

  function mediaSignature(media) {
    if (!media) return '';
    try {
      return [media.currentSrc || media.src || '', Number.isFinite(media.duration) ? media.duration : 0].join('|');
    } catch (e) {
      return '';
    }
  }

  function resetEndState(media) {
    if (media !== lastMedia) {
      lastMedia = media;
      endedTriggered = false;
      lastTrackSignature = mediaSignature(media);
      bindNativeEnded(media);
      return;
    }

    var signature = mediaSignature(media);
    if (signature && signature !== lastTrackSignature) {
      lastTrackSignature = signature;
      if (media.currentTime < 1 || media.duration > 0) {
        endedTriggered = false;
      }
      bindNativeEnded(media);
    }
  }

  function announceEnded(media, source) {
    if (!media || endedTriggered) return;
    endedTriggered = true;

    var trackId = getTrackId();
    var payload = {
      trackId: trackId,
      source: source,
      currentTime: Number(media.currentTime || 0),
      duration: Number(media.duration || 0)
    };

    console.log('[PLAYER] ended', payload);

    try {
      window.dispatchEvent(new CustomEvent('queue-ended-local', { detail: payload }));
    } catch (e) {}

    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'queue-ended',
          trackId: trackId,
          source: source
        }, location.origin);
      } catch (e) {}
    }
  }

  function bindNativeEnded(media) {
    if (!media || media.__queueEndedBound) return;
    media.__queueEndedBound = true;
    media.addEventListener('ended', function () {
      console.log('[PLAYER] native media ended event', {
        trackId: getTrackId(),
        currentTime: Number(media.currentTime || 0),
        duration: Number(media.duration || 0)
      });
      announceEnded(media, 'native-ended');
    });
  }

  function monitorEnded() {
    var media = getMedia();
    if (!media) {
      lastMedia = null;
      endedTriggered = false;
      lastTrackSignature = '';
      return;
    }

    resetEndState(media);

    try {
      var duration = Number(media.duration);
      var current = Number(media.currentTime);

      if (media.ended) {
        announceEnded(media, 'media.ended');
        return;
      }

      if (
        media.paused &&
        Number.isFinite(duration) &&
        duration > 1 &&
        Number.isFinite(current) &&
        current > 1 &&
        current >= duration - 0.35
      ) {
        console.log('[PLAYER] ended fallback detected', {
          trackId: getTrackId(),
          currentTime: current,
          duration: duration
        });
        announceEnded(media, 'playhead-threshold');
      }
    } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'stop-playback') {
      stopPlayback();
    } else if (e.data.type === 'restore-playback') {
      restorePlayback(e.data.playback);
    }
  });

  setInterval(monitorEnded, 150);
})();
