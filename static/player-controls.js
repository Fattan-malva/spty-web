(function () {
  'use strict';

  var lastMedia = null;
  var endedTriggered = false;
  var lastTrackSignature = '';
  var isPlaying = false;
  var lastPosition = -1;
  var lastDebugAt = 0;

  function getTrackId() {
    try { return new URLSearchParams(location.search).get('trackId') || ''; } catch (e) { return ''; }
  }

  function getFrame() {
    return document.getElementById('spWidget');
  }

  function getMediaFromDoc(doc, depth) {
    if (!doc || depth > 5) return null;
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

  function mediaSignature(media) {
    if (!media) return '';
    try {
      return [
        media.currentSrc || media.src || '',
        Number.isFinite(media.duration) ? media.duration : 0
      ].join('|');
    } catch (e) {
      return '';
    }
  }

  function announceEnded(media, source) {
    if (!media || endedTriggered) return;

    endedTriggered = true;
    isPlaying = false;

    var payload = {
      trackId: getTrackId(),
      source: source,
      currentTime: Number(media.currentTime || 0),
      duration: Number(media.duration || 0),
      ended: !!media.ended,
      paused: !!media.paused
    };

    console.log('[PLAYER ENDED] DETECTED', payload);

    try {
      window.dispatchEvent(new CustomEvent('videoEnded', { detail: payload }));
    } catch (e) {}

    try {
      window.dispatchEvent(new CustomEvent('queue-ended-local', { detail: payload }));
    } catch (e) {}

    if (window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'queue-ended',
          trackId: payload.trackId,
          source: source
        }, location.origin);
      } catch (e) {
        console.error('[PLAYER ENDED] postMessage failed', e);
      }
    }
  }

  function bindNativeEnded(media) {
    if (!media || media.__queueEndedBound) return;
    media.__queueEndedBound = true;

    media.addEventListener('play', function () {
      isPlaying = true;
      endedTriggered = false;
      console.log('[PLAYER ENDED] play', { trackId: getTrackId() });
    });

    media.addEventListener('playing', function () {
      isPlaying = true;
    });

    media.addEventListener('pause', function () {
      if (!media.ended) {
        isPlaying = false;
      }
    });

    media.addEventListener('ended', function () {
      console.log('[PLAYER ENDED] native ended event', {
        trackId: getTrackId(),
        currentTime: Number(media.currentTime || 0),
        duration: Number(media.duration || 0),
        ended: media.ended,
        paused: media.paused
      });
      announceEnded(media, 'native-ended');
    });
  }

  function resetForMedia(media) {
    if (media !== lastMedia) {
      lastMedia = media;
      endedTriggered = false;
      isPlaying = !!(media && !media.paused && !media.ended);
      lastPosition = Number(media.currentTime || 0);
      lastTrackSignature = mediaSignature(media);
      bindNativeEnded(media);
      console.log('[PLAYER ENDED] media attached', {
        trackId: getTrackId(),
        duration: Number(media.duration || 0),
        currentTime: Number(media.currentTime || 0),
        paused: media.paused,
        ended: media.ended,
        readyState: media.readyState
      });
      return;
    }

    var signature = mediaSignature(media);
    if (signature && signature !== lastTrackSignature) {
      lastTrackSignature = signature;
      endedTriggered = false;
      if (Number(media.currentTime || 0) < 1) {
        isPlaying = !media.paused && !media.ended;
      }
    }
  }

  function monitorEnded() {
    var media = getMedia();

    if (!media) {
      if (Date.now() - lastDebugAt > 3000) {
        lastDebugAt = Date.now();
        console.log('[PLAYER ENDED] media not found', {
          trackId: getTrackId(),
          frameReady: !!getFrame(),
          frameSrc: getFrame() ? getFrame().src : ''
        });
      }
      lastMedia = null;
      isPlaying = false;
      return;
    }

    resetForMedia(media);

    try {
      var current = Number(media.currentTime || 0);
      var duration = Number(media.duration);
      var playingNow = !media.paused && !media.ended;

      if (playingNow) isPlaying = true;

      if (current + 0.5 < lastPosition) {
        endedTriggered = false;
        console.log('[PLAYER ENDED] replay/reset detected', { currentTime: current });
      }
      lastPosition = current;

      if (Date.now() - lastDebugAt > 3000) {
        lastDebugAt = Date.now();
        console.log('[PLAYER ENDED] monitor', {
          trackId: getTrackId(),
          currentTime: current,
          duration: Number.isFinite(duration) ? duration : null,
          paused: media.paused,
          ended: media.ended,
          isPlaying: isPlaying,
          readyState: media.readyState
        });
      }

      // Primary: exact native ended state/event, same idea as the reference.
      if (media.ended) {
        announceEnded(media, 'media.ended');
        return;
      }

      // Fallback for embeds/WebViews that stop at the duration without
      // exposing the native ended flag/event reliably.
      if (
        isPlaying &&
        Number.isFinite(duration) &&
        duration > 1 &&
        current > 1 &&
        current >= duration - 0.5
      ) {
        console.log('[PLAYER ENDED] playhead threshold', {
          trackId: getTrackId(),
          currentTime: current,
          duration: duration
        });
        announceEnded(media, 'playhead-threshold');
      }
    } catch (e) {
      console.warn('[PLAYER ENDED] monitor error', e);
    }
  }

  function stopPlayback() {
    var media = getMedia();
    if (media) {
      try { media.pause(); } catch (e) {}
    }
    isPlaying = false;
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
          if (p && p.then) {
            p.then(function () {
              isPlaying = true;
              endedTriggered = false;
            }).catch(function () {});
          }
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

  setInterval(monitorEnded, 250);
})();
