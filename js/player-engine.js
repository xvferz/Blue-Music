/**
 * PlaybackEngine — satu antarmuka untuk tiga mesin pemutar:
 *
 *  1. 'local'  : elemen <audio> untuk file lokal (blob) — boleh dirouting ke Web Audio
 *                agar visualizer bekerja.
 *  2. 'stream' : elemen <audio> kedua untuk stream Invidious (latest_version).
 *                TIDAK pernah dirouting ke Web Audio dan tanpa crossOrigin,
 *                karena stream lintas-origin tanpa header CORS akan dibungkam
 *                (silence) oleh MediaElementAudioSourceNode.
 *  3. 'embed'  : YouTube IFrame Player tersembunyi — jaring pengaman yang
 *                (hampir) selalu bisa memutar, gratis, tanpa API key.
 *
 * Aplikasi (MusicPlayer) bicara lewat antarmuka ini:
 *   player.on(evt, fn)      evt: timeupdate | loadedmetadata | ended | playing |
 *                                paused | localerror | streamerror | embederror
 *   player.playLocal(url)
 *   player.playStream([{instance, url}, ...])  -> {ok, mode, instance?}
 *   player.playEmbed(videoId)
 *   player.pause() / player.resume() / player.stopAll()
 *   player.currentTime (get/set) / player.duration (get)
 *   player.setVolume(0..1) / player.setMuted(bool)
 */
class PlaybackEngine {
  constructor() {
    this.localAudio = new Audio();   // file lokal (CORS-clean, aman untuk Web Audio)
    this.localAudio.preload = 'metadata';
    this.streamAudio = new Audio();  // stream Invidious (CORS-dirty, JANGAN dirouting)
    this.streamAudio.preload = 'auto';

    this.mode = 'idle';              // idle | local | stream | embed
    this.volume = 0.7;
    this.muted = false;
    this.loadToken = 0;              // membatalkan pemuatan stream yang sudah basi
    this.streamProbing = false;      // true selama kandidat stream dicoba satu per satu
    this.listeners = {};

    this.ytPlayer = null;
    this.ytApiPromise = null;
    this.ytReady = false;
    this.embedVideoId = null;

    // Kejadian dari elemen audio.
    this.localAudio.addEventListener('loadedmetadata', () => {
      if (this.mode === 'local') this.emit('loadedmetadata');
    });
    this.localAudio.addEventListener('ended', () => {
      if (this.mode === 'local') this.emit('ended');
    });
    this.localAudio.addEventListener('error', () => {
      if (this.mode === 'local') this.emit('localerror');
    });

    this.streamAudio.addEventListener('loadedmetadata', () => {
      if (this.mode === 'stream') this.emit('loadedmetadata');
    });
    this.streamAudio.addEventListener('ended', () => {
      if (this.mode === 'stream') this.emit('ended');
    });
    this.streamAudio.addEventListener('error', () => {
      // Kesalahan saat pemuatan kandidat ditangani di tryStreamCandidate;
      // yang sampai ke sini adalah kegagalan saat lagu sedang berjalan.
      if (this.mode === 'stream' && this.streamAudio.currentSrc && !this.streamProbing) {
        this.emit('streamerror');
      }
    });

    // Penunjuk waktu tunggal (dipakai untuk mode embed juga).
    this.ticker = setInterval(() => {
      if (this.mode !== 'idle') this.emit('timeupdate');
    }, 250);
  }

  // ---------- Event emitter mini ----------

  on(eventName, handler) {
    if (!this.listeners[eventName]) this.listeners[eventName] = [];
    this.listeners[eventName].push(handler);
    return () => {
      this.listeners[eventName] = this.listeners[eventName].filter(h => h !== handler);
    };
  }

  emit(eventName, data) {
    const handlers = this.listeners[eventName] || [];
    for (const handler of handlers) {
      try { handler(data); } catch (e) { console.warn('[Player] handler error:', e); }
    }
  }

  // ---------- Properti antarmuka ----------

  get isEmbed() {
    return this.mode === 'embed';
  }

  get audio() {
    if (this.mode === 'local') return this.localAudio;
    if (this.mode === 'stream') return this.streamAudio;
    return null;
  }

  get currentTime() {
    if (this.isEmbed) {
      return this.ytReady ? (this.ytPlayer.getCurrentTime() || 0) : 0;
    }
    const a = this.audio;
    return a ? a.currentTime : 0;
  }

  set currentTime(t) {
    if (this.isEmbed) {
      if (this.ytReady) this.ytPlayer.seekTo(Math.max(0, t), true);
      return;
    }
    const a = this.audio;
    if (a) a.currentTime = Math.max(0, t);
  }

  get duration() {
    if (this.isEmbed) {
      return this.ytReady ? (this.ytPlayer.getDuration() || 0) : 0;
    }
    const a = this.audio;
    return (a && a.duration) || 0;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.localAudio.volume = this.volume;
    this.streamAudio.volume = this.volume;
    this.applyEmbedVolume();
  }

  setMuted(muted) {
    this.muted = !!muted;
    this.localAudio.muted = this.muted;
    this.streamAudio.muted = this.muted;
    this.applyEmbedVolume();
  }

  applyEmbedVolume() {
    if (!this.ytReady || !this.ytPlayer) return;
    try {
      this.ytPlayer.setVolume(Math.round((this.muted ? 0 : this.volume) * 100));
      if (this.muted) this.ytPlayer.mute();
      else this.ytPlayer.unMute();
    } catch (e) { /* player belum siap */ }
  }

  // ---------- Kendali umum ----------

  pause() {
    if (this.mode === 'local') {
      this.localAudio.pause();
    } else if (this.mode === 'stream') {
      this.streamAudio.pause();
    } else if (this.isEmbed && this.ytReady) {
      try { this.ytPlayer.pauseVideo(); } catch (e) { /* abaikan */ }
    }
    this.emit('paused');
  }

  resume() {
    if (this.mode === 'local') {
      this.localAudio.play().then(() => this.emit('playing')).catch(() => {});
    } else if (this.mode === 'stream') {
      this.streamAudio.play().then(() => this.emit('playing')).catch(() => {});
    } else if (this.isEmbed && this.ytReady) {
      this.applyEmbedVolume();
      try { this.ytPlayer.playVideo(); } catch (e) { /* abaikan */ }
    }
  }

  stopAll() {
    this.loadToken++;
    try { this.localAudio.pause(); } catch (e) { /* abaikan */ }
    try {
      this.streamAudio.pause();
      this.streamAudio.removeAttribute('src');
      this.streamAudio.load();
    } catch (e) { /* abaikan */ }
    if (this.isEmbed && this.ytReady) {
      try { this.ytPlayer.stopVideo(); } catch (e) { /* abaikan */ }
    }
  }

  // ---------- Mesin 1: file lokal ----------

  playLocal(url) {
    this.stopAll();
    this.mode = 'local';
    this.localAudio.src = url;
    this.localAudio.load();
    return this.localAudio.play()
      .then(() => {
        this.emit('playing');
        return { ok: true, mode: 'local' };
      })
      .catch((err) => {
        this.emit('localerror');
        throw err;
      });
  }

  // ---------- Mesin 2: stream Invidious, kandidat dicoba berurutan ----------

  async playStream(candidates) {
    this.stopAll();
    this.mode = 'stream';
    this.streamProbing = true;
    const token = this.loadToken;

    if (!candidates || !candidates.length) {
      this.streamProbing = false;
      return { ok: false, mode: 'stream' };
    }

    for (const candidate of candidates) {
      if (token !== this.loadToken) {
        this.streamProbing = false;
        return { ok: false, aborted: true };
      }
      const ok = await this.tryStreamCandidate(candidate, token);
      if (ok) {
        this.streamProbing = false;
        if (token !== this.loadToken) return { ok: false, aborted: true };
        return { ok: true, mode: 'stream', instance: candidate.instance };
      }
    }

    this.streamProbing = false;
    return { ok: false, mode: 'stream' };
  }

  tryStreamCandidate(candidate, token) {
    return new Promise((resolve) => {
      const a = this.streamAudio;
      let done = false;

      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        a.removeEventListener('loadedmetadata', onMeta);
        a.removeEventListener('error', onErr);
        resolve(ok);
      };

      const onMeta = () => {
        if (token !== this.loadToken || this.mode !== 'stream') {
          finish(false);
          return;
        }
        a.play()
          .then(() => {
            if (token !== this.loadToken || this.mode !== 'stream') {
              finish(false);
              return;
            }
            this.emit('playing');
            finish(true);
          })
          .catch(() => finish(false));
      };

      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(false), 9000);

      a.addEventListener('loadedmetadata', onMeta, { once: true });
      a.addEventListener('error', onErr, { once: true });

      console.log(`[Player] Mencoba stream via ${candidate.instance}…`);
      a.src = candidate.url;
      a.load();
    });
  }

  // ---------- Mesin 3: YouTube IFrame (fallback terakhir) ----------

  async playEmbed(videoId) {
    this.stopAll();
    this.mode = 'embed';
    this.embedVideoId = videoId;
    await this.ensureYT();
    if (!this.ytPlayer) throw new Error('IFrame API tidak tersedia');
    this.applyEmbedVolume();
    this.ytPlayer.loadVideoById(videoId);
    return { ok: true, mode: 'embed' };
  }

  ensureYT() {
    if (this.ytPlayer) return Promise.resolve();
    if (this.ytApiPromise) return this.ytApiPromise;

    this.ytApiPromise = new Promise((resolve, reject) => {
      let settled = false;

      const ready = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('IFrame API timeout'));
      }, 15000);

      if (window.YT && window.YT.Player) {
        clearTimeout(timeout);
        ready();
      } else {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          try { if (previous) previous(); } catch (e) { /* abaikan */ }
          clearTimeout(timeout);
          ready();
        };
      }
    }).then(() => this.createYTPlayer());

    return this.ytApiPromise;
  }

  createYTPlayer() {
    if (this.ytPlayer) return Promise.resolve();

    return new Promise((resolve, reject) => {
      try {
        this.ytPlayer = new window.YT.Player('ytEmbedHost', {
          width: '1',
          height: '1',
          playerVars: {
            playsinline: 1,
            controls: 0,
            disablekb: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              this.ytReady = true;
              this.applyEmbedVolume();
              resolve();
            },
            onStateChange: (e) => this.onYTState(e),
            onError: (e) => this.onYTError(e),
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  onYTState(e) {
    if (this.mode !== 'embed') return;
    if (e.data === 1) {
      this.emit('playing');
    } else if (e.data === 2) {
      this.emit('paused');
    } else if (e.data === 0) {
      this.emit('ended');
    }
  }

  onYTError(e) {
    if (this.mode !== 'embed') return;
    this.emit('embederror', { code: e.data, videoId: this.embedVideoId });
  }
}
