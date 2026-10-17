class MusicPlayer {
  constructor() {
    this.player = new PlaybackEngine();
    this.tracks = [];
    this.onlineTracks = [];
    this.playlists = { all: [], liked: [] };
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isLoadingTrack = false;
    this.streamFallbackAttempted = false;
    this.streamUnavailable = false;
    this.shuffleOn = false;
    this.repeatMode = 'off';
    this.volume = 0.7;
    this.isMuted = false;
    this.analyser = null;
    this.audioCtx = null;
    this.visualizerActive = false;
    this.animFrameId = null;
    this.miniAnimId = null;
    this.youtube = new YouTubeMusicAPI();
    this.activePlaylist = 'all';
    this.searchDebounceId = null;
    this.searchToken = 0;
    this.searchOnlineResults = [];
    this.onlineQueue = [];
    this.embedSkipCount = 0;
    this.queue = [];
    this.downloadInFlight = false;
    this.searchArtists = [];
    this.playlistNames = { all: 'Semua Lagu', liked: 'Lagu Disukai' };
    this.npAnimId = null;
    this.npLastTrackId = null;
    this._queueRenderKey = null;

    // Lirik (Better Lyrics + LRC.RED + LRCLIB)
    this.lyrics = new LyricsEngine({ relay: (url) => this.youtube.fetchJsonViaRelay(url) });
    this.nowTab = 'queue';
    this.lyricsDoc = null;
    this.lyricsTrackId = null;
    this.lyricsMetaKey = null;
    this.lyricsOffset = 0;
    this.lyricsActiveLine = -1;
    this.lyricsActiveWord = -1;
    this.lyricsScrollLockUntil = 0;
    this.lyricElsByIndex = {};

    this.init();
  }

  init() {
    this.cacheDOM();
    this.bindEvents();
    this.loadState();
    this.loadLiked();
    this.loadQueue();
    this.setupAudioContext();
    this.render();
    this.updatePlayerUI();
    this.startMiniVisualizer();
    this.initExplore();
  }

  cacheDOM() {
    this.dom = {
      playBtn: document.getElementById('playBtn'),
      prevBtn: document.getElementById('prevBtn'),
      nextBtn: document.getElementById('nextBtn'),
      shuffleBtn: document.getElementById('shuffleBtn'),
      repeatBtn: document.getElementById('repeatBtn'),
      downloadBtn: document.getElementById('downloadBtn'),
      muteBtn: document.getElementById('muteBtn'),
      likeBtn: document.getElementById('likeBtn'),
      progressBar: document.getElementById('progressBar'),
      progressFill: document.getElementById('progressFill'),
      progressThumb: document.getElementById('progressThumb'),
      volumeBar: document.getElementById('volumeBar'),
      volumeFill: document.getElementById('volumeFill'),
      volumeThumb: document.getElementById('volumeThumb'),
      currentTime: document.getElementById('currentTime'),
      totalTime: document.getElementById('totalTime'),
      nowPlayingCover: document.getElementById('nowPlayingCover'),
      nowPlayingTitle: document.getElementById('nowPlayingTitle'),
      nowPlayingArtist: document.getElementById('nowPlayingArtist'),

      navItems: document.querySelectorAll('.nav-item'),
      pages: document.querySelectorAll('.page'),

      uploadBtn: document.getElementById('uploadBtn'),
      fileInput: document.getElementById('fileInput'),

      trackList: document.getElementById('trackList'),
      recentTracks: document.getElementById('recentTracks'),
      trackCount: document.getElementById('trackCount'),

      searchInput: document.getElementById('searchInput'),
      searchResults: document.getElementById('searchResults'),

      libraryGrid: document.getElementById('libraryGrid'),
      filterBtns: document.querySelectorAll('.filter-btn'),

      playlistList: document.getElementById('playlistList'),
      createPlaylistBtn: document.getElementById('createPlaylistBtn'),
      playlistModal: document.getElementById('playlistModal'),
      playlistNameInput: document.getElementById('playlistNameInput'),
      modalCreate: document.getElementById('modalCreate'),
      modalCancel: document.getElementById('modalCancel'),
      modalClose: document.getElementById('modalClose'),

      visualizerToggle: document.getElementById('visualizerToggle'),
      visualizerOverlay: document.getElementById('visualizerOverlay'),
      visualizerClose: document.getElementById('visualizerClose'),
      visualizerCanvas: document.getElementById('visualizerCanvas'),

      toast: document.getElementById('toast'),

      // Explore
      exploreSearchInput: document.getElementById('exploreSearchInput'),
      exploreSearchBtn: document.getElementById('exploreSearchBtn'),
      genreGrid: document.getElementById('genreGrid'),
      exploreTrending: document.getElementById('exploreTrending'),
      exploreMoodGrid: document.getElementById('exploreMoodGrid'),
      exploreResults: document.getElementById('exploreResults'),
      exploreResultsSection: document.getElementById('exploreResultsSection'),
      exploreResultCount: document.getElementById('exploreResultCount'),
      refreshTrending: document.getElementById('refreshTrending'),

      // Halaman Antrean / Sekarang Diputar
      npCanvas: document.getElementById('npCanvas'),
      npArtwork: document.getElementById('npArtwork'),
      npTitle: document.getElementById('npTitle'),
      npArtist: document.getElementById('npArtist'),
      albumVisual: document.getElementById('albumVisual'),
      queueNow: document.getElementById('queueNow'),
      queueList: document.getElementById('queueList'),
      queueCount: document.getElementById('queueCount'),
      clearQueueBtn: document.getElementById('clearQueueBtn'),
      trackListTitle: document.getElementById('trackListTitle'),

      // Tab Antrean | Lirik
      nowPanel: document.getElementById('nowPanel'),
      nowTabs: document.getElementById('nowTabs'),
      pageNow: document.getElementById('page-now'),
      lyricsBtn: document.getElementById('lyricsBtn'),
      lyricsSource: document.getElementById('lyricsSource'),
      lyricsScroll: document.getElementById('lyricsScroll'),
      lyricsState: document.getElementById('lyricsState'),
      lyricsLines: document.getElementById('lyricsLines'),
      lyricsFoot: document.getElementById('lyricsFoot'),
      lyricsRefreshBtn: document.getElementById('lyricsRefreshBtn'),
      lyricsOffset: document.getElementById('lyricsOffset'),
      lyrOffMinus: document.getElementById('lyrOffMinus'),
      lyrOffVal: document.getElementById('lyrOffVal'),
      lyrOffPlus: document.getElementById('lyrOffPlus'),

      // Mini visualizer di player bar
      miniViz: document.getElementById('miniViz'),
    };
  }

  bindEvents() {
    this.player.on('timeupdate', () => this.onTimeUpdate());
    this.player.on('loadedmetadata', () => this.onLoadedMetadata());
    this.player.on('ended', () => this.onTrackEnd());
    this.player.on('playing', () => this.onPlaying());
    this.player.on('paused', () => this.onPaused());
    this.player.on('localerror', () => this.onLocalError());
    this.player.on('streamerror', () => this.onStreamError());
    this.player.on('embederror', (info) => this.onEmbedError(info));

    this.dom.playBtn.addEventListener('click', () => this.togglePlay());
    this.dom.prevBtn.addEventListener('click', () => this.prevTrack());
    this.dom.nextBtn.addEventListener('click', () => this.nextTrack());
    this.dom.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
    this.dom.repeatBtn.addEventListener('click', () => this.toggleRepeat());
    this.dom.downloadBtn.addEventListener('click', () => this.downloadTrack());
    this.dom.muteBtn.addEventListener('click', () => this.toggleMute());
    this.dom.likeBtn.addEventListener('click', () => this.toggleLike());

    // Slider volume & progress mendukung klik sekaligus geser (drag).
    this.setupSlider(this.dom.volumeBar, (ratio) => this.applyVolume(ratio));
    this.setupSlider(this.dom.progressBar, (ratio) => this.applySeek(ratio));

    this.dom.clearQueueBtn.addEventListener('click', () => this.clearQueue());

    // Tab Antrean | Lirik
    this.dom.nowTabs.querySelectorAll('.now-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchNowTab(btn.dataset.tab));
    });
    this.dom.lyricsBtn.addEventListener('click', () => this.openLyricsPage());
    this.dom.lyricsRefreshBtn.addEventListener('click', () => {
      if (!this.currentTrack()) { this.showToast('Belum ada lagu diputar'); return; }
      this.showToast('Memuat ulang lirik…');
      this.ensureLyricsForCurrent(true);
    });
    this.dom.lyrOffMinus.addEventListener('click', () => this.nudgeLyricsOffset(-0.5));
    this.dom.lyrOffPlus.addEventListener('click', () => this.nudgeLyricsOffset(0.5));
    this.dom.lyrOffVal.addEventListener('click', () => this.nudgeLyricsOffset(0, true));
    this.dom.lyricsLines.addEventListener('click', (e) => {
      const el = e.target.closest('.lyric-line');
      if (!el || el.dataset.time == null) return;
      const t = parseFloat(el.dataset.time) + (this.lyricsOffset || 0);
      if (isNaN(t)) return;
      this.player.currentTime = Math.max(0, t - 0.15);
      this.syncLyricsUI(t, true);
    });
    const lockLyricsScroll = () => { this.lyricsScrollLockUntil = Date.now() + 4000; };
    this.dom.lyricsScroll.addEventListener('wheel', lockLyricsScroll, { passive: true });
    this.dom.lyricsScroll.addEventListener('touchmove', lockLyricsScroll, { passive: true });

    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    this.dom.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchPage(item.dataset.page);
        // Tombol "Antrean" di sidebar selalu membuka daftar antrean.
        if (item.dataset.page === 'now') this.switchNowTab('queue');
      });
    });

    this.dom.uploadBtn.addEventListener('click', () => this.dom.fileInput.click());
    this.dom.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => this.handleDrop(e));

    this.dom.searchInput.addEventListener('input', () => this.onSearchInput());
    this.dom.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(this.searchDebounceId);
        this.runOnlineSearch();
      }
    });

    this.dom.filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelector('.filter-btn.active').classList.remove('active');
        btn.classList.add('active');
        this.renderLibrary(btn.dataset.filter);
      });
    });

    this.dom.createPlaylistBtn.addEventListener('click', () => this.openPlaylistModal());
    this.dom.playlistList.addEventListener('click', (e) => {
      const item = e.target.closest('.playlist-item');
      if (item) this.switchPlaylist(item.dataset.playlist, item);
    });
    this.dom.modalCreate.addEventListener('click', () => this.createPlaylist());
    this.dom.modalCancel.addEventListener('click', () => this.closePlaylistModal());
    this.dom.modalClose.addEventListener('click', () => this.closePlaylistModal());
    this.dom.playlistNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createPlaylist();
    });

    this.dom.visualizerToggle.addEventListener('click', () => this.toggleVisualizer());
    this.dom.visualizerClose.addEventListener('click', () => this.toggleVisualizer());
    this.dom.visualizerOverlay.addEventListener('click', (e) => {
      if (e.target === this.dom.visualizerOverlay) this.toggleVisualizer();
    });

    window.addEventListener('beforeunload', () => this.saveState());
  }

  setupAudioContext() {
    try {
      if (this.srcNode) return;
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Hanya elemen audio LOKAL yang dirouting ke Web Audio.
      // Stream online (CORS-dirty) akan dibungkam kalau dirouting ke sini.
      this.srcNode = this.audioCtx.createMediaElementSource(this.player.localAudio);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.srcNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('AudioContext tidak tersedia:', e);
    }
  }

  // --- Explore / Online Features ---

  initExplore() {
    this.renderGenreGrid();
    this.renderMoodGrid();
    this.loadTrending();
    this.setupExploreEvents();
  }

  setupExploreEvents() {
    this.dom.exploreSearchBtn.addEventListener('click', () => this.searchOnline());
    this.dom.exploreSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.searchOnline();
    });
    this.dom.refreshTrending.addEventListener('click', () => this.loadTrending());
  }

  async loadTrending() {
    const container = this.dom.exploreTrending;
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner"></i><p>Memuat...</p></div>';

    try {
      const tracks = await this.youtube.getTrending();
      this.renderOnlineCards(container, tracks);
    } catch (err) {
      const recents = this.getRecentOnline();
      if (recents.length) {
        this.renderOnlineCards(container, recents);
        this.showToast('Server trending sibuk — menampilkan lagu terakhir diputar');
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <i class="fas fa-cloud-upload-alt"></i>
            <p>Gagal terhubung ke server YouTube.</p>
            <p style="font-size:13px;margin-top:8px">Coba refresh halaman atau gunakan <strong>Cari</strong> di atas untuk mencari lagu.</p>
          </div>`;
      }
    }
  }

  renderMoodGrid() {
    const moods = [
      { name: 'Energik', query: 'workout energy music', icon: 'fa-bolt', color: '#ef4444' },
      { name: 'Santai', query: 'chill relaxing music', icon: 'fa-couch', color: '#10b981' },
      { name: 'Fokus', query: 'focus concentration music', icon: 'fa-brain', color: '#8b5cf6' },
      { name: 'Sedih', query: 'sad emotional songs', icon: 'fa-frown', color: '#6366f1' },
      { name: 'Party', query: 'party dance music', icon: 'fa-glass-cheers', color: '#ec4899' },
      { name: 'Romantis', query: 'romantic love songs', icon: 'fa-heart', color: '#e11d48' },
      { name: 'Travel', query: 'road trip music', icon: 'fa-car', color: '#f59e0b' },
      { name: 'Karaoke', query: 'karaoke instrumental', icon: 'fa-microphone', color: '#06b6d4' },
    ];

    const container = this.dom.exploreMoodGrid;
    if (!container) return;
    container.innerHTML = moods.map(m => `
      <div class="genre-card mood-card" data-mood="${this.escapeHtml(m.query)}">
        <i class="fas ${m.icon}" style="color:${m.color}"></i>
        <span>${m.name}</span>
      </div>
    `).join('');

    container.querySelectorAll('.mood-card').forEach(card => {
      card.addEventListener('click', () => this.searchMood(card.dataset.mood));
    });
  }

  async searchMood(query) {
    this.switchPage('explore');
    this.dom.exploreSearchInput.value = query;

    const container = this.dom.exploreTrending;
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner"></i><p>Memuat...</p></div>';

    const tracks = await this.youtube.search(query, 20);
    if (tracks.length) {
      this.renderOnlineCards(container, tracks);
      this.dom.exploreResultsSection.style.display = 'none';
    } else {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Tidak ada hasil. Coba mood lain.</p></div>';
    }
  }

  renderGenreGrid() {
    const genres = [
      { name: 'Electronic', query: 'electronic music mix', icon: 'fa-wave-square', color: '#6366f1' },
      { name: 'Hip Hop', query: 'hip hop rap', icon: 'fa-microphone', color: '#f59e0b' },
      { name: 'Pop', query: 'pop music hits', icon: 'fa-star', color: '#ec4899' },
      { name: 'Rock', query: 'rock music', icon: 'fa-guitar', color: '#ef4444' },
      { name: 'R&B', query: 'r&b soul music', icon: 'fa-heart', color: '#e11d48' },
      { name: 'Jazz', query: 'jazz music', icon: 'fa-saxophone', color: '#8b5cf6' },
      { name: 'Lo-Fi', query: 'lo fi hip hop', icon: 'fa-couch', color: '#10b981' },
      { name: 'Ambient', query: 'ambient music', icon: 'fa-cloud', color: '#06b6d4' },
      { name: 'Classical', query: 'classical music', icon: 'fa-piano', color: '#f472b6' },
      { name: 'Folk', query: 'folk acoustic music', icon: 'fa-tree', color: '#22c55e' },
    ];

    this.dom.genreGrid.innerHTML = genres.map(g => `
      <div class="genre-card" data-query="${this.escapeHtml(g.query)}">
        <i class="fas ${g.icon}" style="color:${g.color}"></i>
        <span>${g.name}</span>
      </div>
    `).join('');

    this.dom.genreGrid.querySelectorAll('.genre-card').forEach(card => {
      card.addEventListener('click', () => this.browseGenre(card.dataset.query));
    });
  }

  async browseGenre(query) {
    this.switchPage('explore');

    const container = this.dom.exploreTrending;
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner"></i><p>Memuat...</p></div>';

    const tracks = await this.youtube.search(query, 20);
    if (tracks.length) {
      this.renderOnlineCards(container, tracks);
      this.dom.exploreResultsSection.style.display = 'none';
    } else {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Tidak ada hasil. Coba genre lain atau gunakan pencarian.</p></div>';
    }
  }

  // --- Baris lagu online (dipakai di pencarian, jelajahi, halaman artis) ---

  onlineRowHtml(track, i, query = '') {
    const duration = track.duration ? this.formatTime(track.duration) : '--:--';
    const current = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
    const isPlaying = current && current.id === track.id;
    const isLiked = this.playlists.liked.some(t => t.id === track.id);
    const title = query ? this.highlightMatch(this.escapeHtml(track.title), query) : this.escapeHtml(track.title);
    const artist = query ? this.highlightMatch(this.escapeHtml(track.artist), query) : this.escapeHtml(track.artist);

    return `
      <div class="track-item ${isPlaying ? 'playing' : ''}" data-online-id="${track.id}">
        <span class="track-index">${isPlaying ? '<i class="fas fa-volume-up" style="color:var(--accent-primary)"></i>' : (i + 1)}</span>
        <div class="track-info">
          <div class="track-name">${title} <span class="track-source">YouTube</span></div>
          <div class="track-artist-name">${artist}</div>
        </div>
        <span class="track-duration">${duration}</span>
        <div class="track-actions">
          <button class="track-like-btn" data-id="${track.id}" title="Sukai">
            <i class="${isLiked ? 'fas' : 'far'} fa-heart"></i>
          </button>
          <button class="track-queue-btn" data-id="${track.id}" title="Tambahkan ke antrean">
            <i class="fas fa-plus"></i>
          </button>
          <button class="track-dl-btn" data-id="${track.id}" title="Download">
            <i class="fas fa-download"></i>
          </button>
        </div>
      </div>`;
  }

  wireOnlineRows(container, tracks, query = '') {
    const findTrack = (el) => {
      const id = el.dataset.onlineId || el.dataset.id;
      return tracks.find(t => t.id === id);
    };

    container.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.track-actions')) return;
        const track = findTrack(el);
        if (track) {
          this.playOnlineTrack(track, tracks);
          this.openQueuePage();
        }
      });
    });

    container.querySelectorAll('.track-like-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = findTrack(btn);
        if (!track) return;

        const likedNow = this.playlists.liked.some(t => t.id === track.id);
        track.liked = !likedNow;

        const entry = this.tracks.find(t => t.id === track.id);
        if (entry) entry.liked = track.liked;

        if (track.liked) {
          if (!likedNow) this.playlists.liked.push(entry || track);
        } else {
          this.playlists.liked = this.playlists.liked.filter(t => t.id !== track.id);
        }
        this.saveLiked();

        // Perbarui ikon hati tanpa merender ulang seluruh baris.
        container.querySelectorAll('.track-item').forEach(row => {
          const t = findTrack(row);
          if (!t) return;
          const icon = row.querySelector('.track-like-btn i');
          if (icon) {
            const liked = this.playlists.liked.some(x => x.id === t.id);
            icon.className = liked ? 'fas fa-heart' : 'far fa-heart';
          }
        });
        this.updatePlayerUI();
      });
    });

    container.querySelectorAll('.track-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = findTrack(btn);
        if (track) this.addToQueue(track);
      });
    });

    container.querySelectorAll('.track-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = findTrack(btn);
        if (track) this.downloadOnlineTrack(track);
      });
    });
  }

  renderOnlineCards(container, tracks) {
    if (!tracks.length) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Tidak ada lagu ditemukan</p></div>';
      return;
    }

    this.onlineTracks = tracks;

    container.innerHTML = tracks.map(track => {
      const artworkStyle = track.artwork
        ? `<img src="${track.artwork}" alt="${this.escapeHtml(track.title)}" loading="lazy" onerror="this.parentElement.classList.remove('has-artwork')">`
        : '';
      return `
        <div class="music-card online-card" data-online-id="${track.id}">
          <div class="music-card-cover ${track.artwork ? 'has-artwork' : ''}">
            ${artworkStyle || '<i class="fas fa-music"></i>'}
            <button class="card-queue-btn" data-online-id="${track.id}" title="Tambahkan ke antrean">
              <i class="fas fa-plus"></i>
            </button>
            <div class="play-overlay">
              <i class="fas fa-play-circle"></i>
            </div>
          </div>
          <div class="music-card-title">${this.escapeHtml(track.title)}</div>
          <div class="music-card-artist">${this.escapeHtml(track.artist)}</div>
          <span class="source-badge online"><i class="fab fa-youtube"></i> YouTube</span>
        </div>`;
    }).join('');

    container.querySelectorAll('.card-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = tracks.find(t => t.id === btn.dataset.onlineId);
        if (track) this.addToQueue(track);
      });
    });

    container.querySelectorAll('.online-card').forEach(card => {
      card.addEventListener('click', () => {
        const onlineId = card.dataset.onlineId;
        const track = this.onlineTracks.find(t => t.id === onlineId);
        if (track) {
          this.playOnlineTrack(track, this.onlineTracks);
          this.openQueuePage();
        }
      });
    });
  }

  async searchOnline() {
    const query = this.dom.exploreSearchInput.value.trim();
    if (!query) return;

    const container = this.dom.exploreResults;
    const section = this.dom.exploreResultsSection;
    section.style.display = 'block';
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner"></i><p>Mencari...</p></div>';

    // BUNGKUS DENGAN TRY...CATCH
    try {
      const tracks = await this.youtube.search(query, 30);
      this.dom.exploreResultCount.textContent = `${tracks.length} hasil`;

      if (!tracks.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>Tidak ditemukan hasil. Coba kata kunci lain.</p></div>';
        return;
      }

      this.onlineTracks = tracks;

      container.innerHTML = tracks.map((track, i) => this.onlineRowHtml(track, i, query)).join('');
      this.wireOnlineRows(container, tracks, query);

    } catch (error) {
      // TAMPILKAN PESAN ERROR JIKA GAGAL
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Gagal mencari lagu.</p>
          <p style="font-size:13px;margin-top:8px">Semua server publik sedang sibuk atau tidak bisa diakses.</p>
          <p style="font-size:13px;margin-top:4px">Coba lagi sebentar lagi, atau isi <code>YT_DATA_API_KEY</code> di <code>js/youtube.js</code> untuk pencarian yang selalu andal.</p>
        </div>`;
      console.error(error);
    }
  }
  async playOnlineTrack(track, queue = null, auto = false) {
    if (!auto) this.embedSkipCount = 0;
    this.onlineQueue = queue || [];

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    // Daftarkan lagu ke daftar utama agar next/prev/playlist mengenalnya.
    let entry = this.tracks.find(t => t.id === track.id);
    if (!entry) {
      entry = { ...track, source: 'youtube', isOnline: true, url: null };
      this.tracks.push(entry);
      this.playlists.all.push(entry);
    }
    this.currentIndex = this.tracks.indexOf(entry);
    this.isLoadingTrack = true;
    this.streamFallbackAttempted = false;
    this.updatePlayerUI();
    this.render();

    // Jalur 1: stream audio mentah (kalau server stream masih memungkinkan).
    if (!this.streamUnavailable) {
      const candidates = this.youtube.getStreamUrls(track.videoId);
      const result = await this.player.playStream(candidates);

      if (result.aborted) return;

      if (result.ok) {
        this.youtube.rememberStreamInstance(result.instance);
        this.isLoadingTrack = false;
        this.isPlaying = true;
        this.updatePlayerUI();
        this.render();
        return;
      }

      // Sekali gagal → untuk sesi ini langsung pakai embed, supaya tidak
      // menunggu timeout di setiap lagu. Muat ulang halaman untuk coba lagi.
      this.streamUnavailable = true;
    }

    // Jalur 2: embed YouTube — (hampir) selalu bisa memutar.
    console.warn('[Player] Stream mentah tidak tersedia, memakai embed YouTube.');
    try {
      await this.player.playEmbed(track.videoId);
      this.isLoadingTrack = false;
      this.isPlaying = true;
      this.updatePlayerUI();
      this.render();
    } catch (err) {
      this.isLoadingTrack = false;
      this.showToast('Semua jalur pemutaran gagal. Coba lagu lain.');
      this.updatePlayerUI();
    }
  }

  // --- Local File Handling ---

  handleFileUpload(e) {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
    this.addTracks(files);
    this.dom.fileInput.value = '';
  }

  handleDrop(e) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (files.length) this.addTracks(files);
  }

  addTracks(files) {
    const newTracks = [];
    files.forEach((file, i) => {
      const url = URL.createObjectURL(file);
      const track = {
        id: 'local_' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 8),
        title: this.cleanFileName(file.name),
        artist: 'Artis Tidak Diketahui',
        album: 'Album Tidak Diketahui',
        duration: 0,
        url: url,
        file: file,
        liked: false,
        dateAdded: Date.now(),
        source: 'local',
      };

      this.readMetadata(file, track);
      newTracks.push(track);
      this.tracks.push(track);
      this.playlists.all.push(track);
    });

    this.render();
    this.showToast(`${newTracks.length} lagu lokal berhasil ditambahkan`);
    if (this.currentIndex === -1 && this.tracks.length > 0) {
      this.playTrack(this.tracks.length - newTracks.length);
    }
  }

  cleanFileName(name) {
    return name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  }

  readMetadata(file, track) {
    const name = this.cleanFileName(file.name);
    const parts = name.split(/[–\-—|]+/).map(s => s.trim());
    if (parts.length >= 2) {
      track.artist = parts[0].trim();
      track.title = parts.slice(1).join(' - ').trim();
    }
  }

  // --- Playback ---

  playTrack(index) {
    if (index < 0 || index >= this.tracks.length) return;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.currentIndex = index;
    const track = this.tracks[index];

    if (track.isOnline) {
      this.playOnlineTrack(track);
      return;
    }

    this.player.playLocal(track.url)
      .then(() => {
        this.isPlaying = true;
        this.updatePlayerUI();
        this.render();
      })
      .catch((err) => {
        console.warn('Gagal memutar:', err);
        this.showToast('Gagal memutar lagu');
      });
  }

  togglePlay() {
    if (this.tracks.length === 0) {
      this.showToast('Belum ada lagu. Tambahkan musik lokal atau jelajahi online.');
      return;
    }
    if (this.currentIndex === -1) {
      this.playTrack(0);
      return;
    }

    if (this.isPlaying) {
      this.player.pause();
      this.isPlaying = false;
    } else {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.player.resume();
      this.isPlaying = true;
    }
    this.updatePlayerUI();
    this.render();
  }

  prevTrack() {
    if (this.tracks.length === 0) return;

    if (this.player.currentTime > 3) {
      this.player.currentTime = 0;
      return;
    }

    let index;
    if (this.shuffleOn) {
      index = this.getRandomIndex();
    } else {
      index = this.currentIndex - 1;
      if (index < 0) index = this.tracks.length - 1;
    }
    this.playTrack(index);
  }

  nextTrack() {
    // Antrean manual selalu didahulukan.
    if (this.queue.length) {
      const next = this.queue.shift();
      this.saveQueue();
      this.renderQueue();
      this.playQueuedTrack(next);
      return;
    }

    if (this.tracks.length === 0) return;

    let index;
    if (this.shuffleOn) {
      index = this.getRandomIndex();
    } else {
      index = this.currentIndex + 1;
      if (index >= this.tracks.length) {
        if (this.repeatMode === 'all') {
          index = 0;
        } else {
          return;
        }
      }
    }
    this.playTrack(index);
  }

  getRandomIndex() {
    const remaining = this.tracks
      .map((_, i) => i)
      .filter(i => i !== this.currentIndex);
    if (remaining.length === 0) return this.currentIndex;
    return remaining[Math.floor(Math.random() * remaining.length)];
  }

  toggleShuffle() {
    this.shuffleOn = !this.shuffleOn;
    this.dom.shuffleBtn.classList.toggle('active');
    this.showToast(this.shuffleOn ? 'Acak: Aktif' : 'Acak: Nonaktif');
  }

  toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const idx = modes.indexOf(this.repeatMode);
    this.repeatMode = modes[(idx + 1) % modes.length];

    this.dom.repeatBtn.classList.remove('active', 'repeat-one');
    if (this.repeatMode === 'all') {
      this.dom.repeatBtn.classList.add('active');
      this.showToast('Ulangi semua: Aktif');
    } else if (this.repeatMode === 'one') {
      this.dom.repeatBtn.classList.add('active', 'repeat-one');
      this.dom.repeatBtn.innerHTML = '<i class="fas fa-repeat"></i><sup>1</sup>';
      this.showToast('Ulangi satu: Aktif');
    } else {
      this.dom.repeatBtn.innerHTML = '<i class="fas fa-repeat"></i>';
      this.showToast('Ulangi: Nonaktif');
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.player.setMuted(this.isMuted);
    this.dom.muteBtn.innerHTML = this.isMuted
      ? '<i class="fas fa-volume-mute"></i>'
      : `<i class="fas fa-volume-${this.volume > 0.5 ? 'up' : this.volume > 0 ? 'down' : 'off'}"></i>`;
  }

  toggleLike() {
    if (this.currentIndex === -1 || !this.tracks[this.currentIndex]) return;
    const track = this.tracks[this.currentIndex];
    track.liked = !track.liked;
    this.dom.likeBtn.classList.toggle('liked');
    this.dom.likeBtn.innerHTML = track.liked
      ? '<i class="fas fa-heart"></i>'
      : '<i class="far fa-heart"></i>';

    if (track.liked) {
      if (!this.playlists.liked.find(t => t.id === track.id)) {
        this.playlists.liked.push(track);
      }
    } else {
      this.playlists.liked = this.playlists.liked.filter(t => t.id !== track.id);
    }
    this.saveLiked();
    this.render();
  }

  // --- Slider (volume & progress) — klik dan geser ---

  setupSlider(el, onRatio) {
    if (!el) return;

    const ratioFromEvent = (e) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
      el.classList.add('dragging');
      onRatio(ratioFromEvent(e));

      const move = (ev) => onRatio(ratioFromEvent(ev));
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };

      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  applyVolume(ratio) {
    this.volume = ratio;
    if (ratio > 0 && this.isMuted) {
      this.isMuted = false;
      this.player.setMuted(false);
    }
    this.player.setVolume(this.volume);
    this.dom.muteBtn.innerHTML = this.volume > 0.5
      ? '<i class="fas fa-volume-up"></i>'
      : this.volume > 0
        ? '<i class="fas fa-volume-down"></i>'
        : '<i class="fas fa-volume-off"></i>';
    this.updateVolumeUI();
  }

  applySeek(ratio) {
    const duration = this.player.duration;
    if (!duration) return;
    this.player.currentTime = ratio * duration;
    this.dom.progressFill.style.width = `${ratio * 100}%`;
    this.dom.currentTime.textContent = this.formatTime(ratio * duration);
  }

  downloadTrack() {
    if (this.currentIndex === -1 || !this.tracks[this.currentIndex]) {
      this.showToast('Tidak ada lagu yang dipilih');
      return;
    }

    const track = this.tracks[this.currentIndex];
    if (track.isOnline) {
      this.downloadOnlineTrack(track);
      return;
    }

    const a = document.createElement('a');
    a.href = track.url;
    a.download = (track.artist !== 'Artis Tidak Diketahui' ? track.artist + ' - ' : '') + track.title + '.mp3';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.showToast(`Mendownload: ${track.title}`);
  }

  // --- Download lagu online ---

  async downloadOnlineTrack(track) {
    if (!track || !track.videoId) {
      this.showToast('Lagu ini tidak bisa diunduh.');
      return;
    }
    if (this.downloadInFlight) {
      this.showToast('Masih ada unduhan yang sedang disiapkan…');
      return;
    }

    this.downloadInFlight = true;
    this.showToast('Menyiapkan unduhan… (bisa ±30 detik)');

    try {
      const url = await this.youtube.getDownloadUrl(track.videoId, (pct) => {
        this.showToast(`Menyiapkan unduhan… ${pct}%`);
      });
      this.showToast(`Unduhan siap: ${track.title}`);

      // iframe tersembunyi: file dikirim dengan header
      // Content-Disposition attachment sehingga langsung terunduh
      // tanpa diblokir popup blocker.
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = url;
      document.body.appendChild(frame);
      setTimeout(() => {
        try { frame.remove(); } catch (e) { /* abaikan */ }
      }, 120000);
    } catch (err) {
      console.warn('[Download] Gagal:', err && err.message);
      this.showToast('Gagal menyiapkan unduhan. Coba lagi sebentar lagi.');
    } finally {
      this.downloadInFlight = false;
    }
  }

  // --- Antrean (queue) ---

  openQueuePage() {
    this.switchPage('now');
    this.switchNowTab('queue');
  }

  addToQueue(track) {
    if (!track) return;
    const entry = this.tracks.find(t => t.id === track.id);
    this.queue.push(entry || { ...track });
    this.saveQueue();
    this.renderQueue();
    this.showToast(`Ditambahkan ke antrean: ${track.title}`);
  }

  removeFromQueue(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.queue.splice(i, 1);
    this.saveQueue();
    this.renderQueue();
  }

  clearQueue() {
    if (!this.queue.length) {
      this.showToast('Antrean sudah kosong');
      return;
    }
    this.queue = [];
    this.saveQueue();
    this.renderQueue();
    this.showToast('Antrean dibersihkan');
  }

  playFromQueue(i) {
    if (i < 0 || i >= this.queue.length) return;
    const track = this.queue.splice(i, 1)[0];
    this.saveQueue();
    this.renderQueue();
    this.playQueuedTrack(track);
  }

  playQueuedTrack(track) {
    if (!track) return;
    const existing = this.tracks.find(t => t.id === track.id);
    const target = existing || track;

    if (target.isOnline || target.source === 'youtube') {
      this.playOnlineTrack(target, this.queue.slice());
      return;
    }
    if (existing) this.playTrack(this.tracks.indexOf(existing));
  }

  saveQueue() {
    try {
      const data = this.queue
        .filter(t => t && (t.isOnline || t.source === 'youtube'))
        .map(t => ({
          id: t.id,
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          duration: t.duration || 0,
          artwork: t.artwork || null,
          source: 'youtube',
          isOnline: true,
        }));
      localStorage.setItem('bluesync_queue', JSON.stringify(data));
    } catch (e) { /* abaikan */ }
  }

  loadQueue() {
    try {
      const raw = localStorage.getItem('bluesync_queue');
      const list = raw ? JSON.parse(raw) : [];
      this.queue = Array.isArray(list) ? list.filter(t => t && t.id) : [];
    } catch (e) {
      this.queue = [];
    }
  }

  // --- Lagu disukai (persisten untuk lagu online) ---

  saveLiked() {
    try {
      const data = this.playlists.liked
        .filter(t => t && (t.isOnline || t.source === 'youtube'))
        .map(t => ({
          id: t.id,
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          duration: t.duration || 0,
          artwork: t.artwork || null,
          source: 'youtube',
          isOnline: true,
          liked: true,
        }));
      localStorage.setItem('bluesync_liked', JSON.stringify(data));
    } catch (e) { /* abaikan */ }
  }

  loadLiked() {
    try {
      const raw = localStorage.getItem('bluesync_liked');
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return;
      for (const t of list) {
        if (!t || !t.id) continue;
        let entry = this.tracks.find(x => x.id === t.id);
        if (!entry) {
          entry = { ...t, liked: true };
          this.tracks.push(entry);
        }
        entry.liked = true;
        if (!this.playlists.liked.find(x => x.id === entry.id)) {
          this.playlists.liked.push(entry);
        }
      }
    } catch (e) { /* abaikan */ }
  }

  // --- Halaman Antrean / Sekarang Diputar ---

  renderQueue() {
    const current = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
    const key = (current ? current.id : '') + '|' + this.isPlaying + '|' + this.queue.map(t => t.id).join(',');
    if (key === this._queueRenderKey) return;
    this._queueRenderKey = key;

    this.dom.queueCount.textContent = `${this.queue.length} lagu`;

    if (current) {
      this.dom.queueNow.innerHTML = `
        <div class="queue-now-label"><i class="fas fa-volume-up"></i> Sedang diputar</div>
        <div class="track-item queue-current">
          <span class="track-index">${this.isPlaying ? '<i class="fas fa-volume-up" style="color:var(--accent-primary)"></i>' : '<i class="fas fa-pause"></i>'}</span>
          <div class="track-info">
            <div class="track-name">${this.escapeHtml(current.title)}${current.isOnline ? ' <span class="track-source">YouTube</span>' : ''}</div>
            <div class="track-artist-name">${this.escapeHtml(current.artist)}</div>
          </div>
          <span class="track-duration">${current.duration ? this.formatTime(current.duration) : '--:--'}</span>
        </div>`;
    } else {
      this.dom.queueNow.innerHTML = '<div class="queue-now-label"><i class="fas fa-music"></i> Belum ada lagu diputar</div>';
    }

    if (!this.queue.length) {
      this.dom.queueList.innerHTML = `
        <div class="empty-state queue-empty">
          <i class="fas fa-list-ul"></i>
          <p>Antrean kosong</p>
          <p style="font-size:13px;margin-top:6px">Tekan tombol <strong>+</strong> pada lagu mana pun untuk menambahkannya ke antrean.</p>
        </div>`;
      return;
    }

    this.dom.queueList.innerHTML = this.queue.map((track, i) => `
      <div class="track-item queue-item" data-queue-index="${i}">
        <span class="track-index">${i + 1}</span>
        <div class="track-info">
          <div class="track-name">${this.escapeHtml(track.title)}${track.isOnline || track.source === 'youtube' ? ' <span class="track-source">YouTube</span>' : ''}</div>
          <div class="track-artist-name">${this.escapeHtml(track.artist)}</div>
        </div>
        <span class="track-duration">${track.duration ? this.formatTime(track.duration) : '--:--'}</span>
        <div class="track-actions">
          <button class="track-remove-btn" data-queue-index="${i}" title="Hapus dari antrean">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>`).join('');

    this.dom.queueList.querySelectorAll('.queue-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.track-actions')) return;
        const i = parseInt(el.dataset.queueIndex, 10);
        if (!isNaN(i)) this.playFromQueue(i);
      });
    });

    this.dom.queueList.querySelectorAll('.track-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.dataset.queueIndex, 10);
        if (!isNaN(i)) this.removeFromQueue(i);
      });
    });
  }

  renderNowPlaying() {
    const track = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;

    if (track) {
      this.dom.npTitle.textContent = track.title;
      this.dom.npArtist.textContent = track.artist + (track.isOnline ? ' · YouTube' : '');

      if (this.npLastTrackId !== track.id) {
        this.npLastTrackId = track.id;
        this.dom.npArtwork.innerHTML = track.artwork
          ? `<img src="${track.artwork}" alt="" onerror="this.remove()">`
          : this.defaultArtworkHtml(track);
      }
      this.dom.albumVisual.classList.toggle('playing', this.isPlaying);
    } else {
      this.dom.npTitle.textContent = 'Belum ada lagu';
      this.dom.npArtist.textContent = 'Pilih lagu untuk mulai';
      if (this.npLastTrackId !== null) {
        this.npLastTrackId = null;
        this.dom.npArtwork.innerHTML = '<i class="fas fa-music"></i>';
      }
      this.dom.albumVisual.classList.remove('playing');
    }
  }

  defaultArtworkHtml(track) {
    const hue = this.hashHue(track.artist || track.title || 'blue');
    return `<div class="album-art-fallback" style="background:linear-gradient(135deg, hsl(${hue},60%,30%), hsl(${(hue + 40) % 360},70%,16%))"><i class="fas fa-music"></i></div>`;
  }

  hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  // --- Visualizer album (canvas halaman antrean) ---

  /**
   * Gambar satu bingkai bar visualizer ke sebuah canvas.
   * Musik lokal → data analyser sungguhan. Pemutaran online (embed)
   * tidak memberi akses audio, jadi dipakai pola sintetis lembut supaya
   * visualizer tetap hidup.
   */
  drawBarsFrame(canvas, opts = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    if (rect.width && (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height))) {
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
    }
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;

    const trail = opts.trail || 0;
    if (trail > 0) {
      ctx.fillStyle = `${opts.trailColor || 'rgba(6, 10, 24,'} ${trail})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    const bars = Math.max(4, opts.bars || 48);
    const gap = opts.gap != null ? opts.gap : 3;
    const barW = Math.max(1, (w - gap * (bars - 1)) / bars);
    const radius = Math.min(barW / 2, opts.radius != null ? opts.radius : 3);
    const scale = opts.heightScale || 0.92;
    const minH = opts.minHeight != null ? opts.minHeight : 3;
    const active = opts.active != null ? opts.active : 1;
    const speed = opts.speed || 1;
    const colors = opts.colors || ['rgba(30, 64, 175, 0.75)', 'rgba(59, 130, 246, 0.75)', 'rgba(147, 197, 253, 0.85)'];

    let data = null;
    if (this.analyser && this.player.mode === 'local' && this.audioCtx && this.audioCtx.state === 'running') {
      if (!this._vizData || this._vizData.length !== this.analyser.frequencyBinCount) {
        this._vizData = new Uint8Array(this.analyser.frequencyBinCount);
      }
      this.analyser.getByteFrequencyData(this._vizData);
      data = this._vizData;
    }

    const t = (performance.now() / 1000) * speed;
    for (let i = 0; i < bars; i++) {
      let v;
      if (data) {
        v = data[Math.floor((i / bars) * data.length)] / 255;
      } else {
        const n = Math.sin(t * 1.7 + i * 0.55) * 0.5 + Math.sin(t * 0.9 + i * 1.31) * 0.5;
        v = Math.max(0.06, (0.45 + n * 0.28) * active);
      }

      const bh = Math.max(minH, v * h * scale);
      const x = i * (barW + gap);
      const y = h - bh;
      const grad = ctx.createLinearGradient(0, h, 0, y);
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(0.6, colors[1]);
      grad.addColorStop(1, colors[2]);
      ctx.fillStyle = grad;

      if (opts.rounded === false || radius < 1) {
        ctx.fillRect(x, y, barW, bh);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + barW, y, x + barW, y + bh, radius);
      ctx.arcTo(x + barW, y + bh, x, y + bh, radius);
      ctx.arcTo(x, y + bh, x, y, radius);
      ctx.arcTo(x, y, x + barW, y, radius);
      ctx.closePath();
      ctx.fill();
    }
  }

  startNpVisualizer() {
    if (this.npAnimId) return;
    if (!this.dom.npCanvas) return;

    const draw = () => {
      this.npAnimId = requestAnimationFrame(draw);
      this.drawBarsFrame(this.dom.npCanvas, {
        bars: 48,
        gap: 3,
        active: this.isPlaying ? 1 : 0.22,
      });
    };

    draw();
  }

  stopNpVisualizer() {
    if (this.npAnimId) {
      cancelAnimationFrame(this.npAnimId);
      this.npAnimId = null;
    }
    const canvas = this.dom.npCanvas;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  // --- Mini visualizer di player bar (selalu hidup) ---

  startMiniVisualizer() {
    if (this.miniAnimId || !this.dom.miniViz) return;

    const draw = () => {
      this.miniAnimId = requestAnimationFrame(draw);
      this.drawBarsFrame(this.dom.miniViz, {
        bars: 14,
        gap: 2,
        radius: 1.5,
        minHeight: 2,
        speed: 1.35,
        active: this.isPlaying ? 1 : 0.22,
      });
    };

    draw();
  }

  // --- Lirik (Better Lyrics + LRCLIB) ---

  currentTrack() {
    return this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
  }

  openLyricsPage() {
    this.switchPage('now');
    this.switchNowTab('lyrics');
  }

  switchNowTab(tab) {
    this.nowTab = tab === 'lyrics' ? 'lyrics' : 'queue';
    const panel = this.dom.nowPanel;
    if (panel) {
      panel.classList.toggle('tab-lyrics', this.nowTab === 'lyrics');
      panel.classList.toggle('tab-queue', this.nowTab !== 'lyrics');
    }
    this.dom.nowTabs.querySelectorAll('.now-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === this.nowTab);
    });
    const onNow = this.dom.pageNow && this.dom.pageNow.classList.contains('active');
    this.dom.lyricsBtn.classList.toggle('active', onNow && this.nowTab === 'lyrics');
    if (this.nowTab === 'lyrics') this.ensureLyricsForCurrent();
  }

  lyricsPaneVisible() {
    return this.nowTab === 'lyrics' && this.dom.pageNow && this.dom.pageNow.classList.contains('active');
  }

  ensureLyricsForCurrent(force = false) {
    const track = this.currentTrack();
    if (!track) {
      this.lyricsTrackId = null;
      this.lyricsDoc = null;
      this.lyricsMetaKey = null;
      this.lyricsOffset = 0;
      this.showLyricsState('idle');
      return;
    }

    // Offset sinkronisasi khusus lagu ini (mis. video dengan intro).
    this.lyricsMetaKey = this.lyrics.offsetKey(track);
    this.lyricsOffset = this.lyricsMetaKey ? this.lyrics.getOffset(this.lyricsMetaKey) : 0;
    this.updateLyricsOffsetUI();

    if (!force && this.lyricsTrackId === track.id && this.lyricsDoc) {
      this.syncLyricsUI(this.player.currentTime || 0, true);
      return;
    }

    const trackId = track.id;
    this.lyricsTrackId = trackId;
    this.lyricsDoc = null;
    this.showLyricsState('loading');

    this.lyrics.load(track, (doc) => {
      if (this.lyricsTrackId !== trackId) return;
      this.renderLyricsDoc(doc);
    }, { force }).then((doc) => {
      if (this.lyricsTrackId !== trackId) return;
      const usable = doc && (doc.instrumental || doc.plain || (doc.lines && doc.lines.length));
      if (!usable) {
        this.lyricsDoc = null;
        this.showLyricsState('empty');
      } else if (!this.lyricsDoc) {
        this.renderLyricsDoc(doc);
      }
    });
  }

  renderLyricsDoc(doc) {
    if (!doc) return;
    this.lyricsDoc = doc;
    this.lyricsActiveLine = -1;
    this.lyricsActiveWord = -1;
    this.lyricElsByIndex = {};

    const providerMeta = {
      better: { name: 'Better Lyrics', icon: 'fa-bolt' },
      lrcred: { name: 'LRC.RED', icon: 'fa-fire' },
      lrclib: { name: 'LRCLIB', icon: 'fa-database' },
    }[doc.provider] || { name: 'LRCLIB', icon: 'fa-database' };
    const provider = providerMeta.name;
    let syncLabel = 'tanpa penanda waktu';
    if (doc.instrumental) syncLabel = 'instrumental';
    else if (doc.sync === 'word') syncLabel = 'karaoke per kata';
    else if (doc.sync === 'line') syncLabel = 'tersinkron';
    const syncOk = doc.sync !== 'none' && !doc.instrumental;

    this.dom.lyricsSource.innerHTML =
      `<span class="lyrics-badge"><i class="fas ${providerMeta.icon}"></i> ${provider}</span>` +
      `<span class="lyrics-sync${syncOk ? ' ok' : ''}">${syncLabel}</span>`;
    this.updateLyricsOffsetUI();

    if (doc.instrumental) {
      this.showLyricsState('instrumental');
      return;
    }

    const lines = Array.isArray(doc.lines) ? doc.lines : [];

    if (!lines.length && doc.plain) {
      this.dom.lyricsLines.innerHTML = String(doc.plain)
        .split(/\r?\n/)
        .map((l) => (l.trim()
          ? `<div class="lyric-line plain">${this.escapeHtml(l)}</div>`
          : '<div class="lyric-gap"></div>'))
        .join('');
      this.dom.lyricsState.style.display = 'none';
      this.setLyricsFoot(`Lirik ${provider} (tanpa penanda waktu).`);
      this.dom.lyricsScroll.scrollTop = 0;
      return;
    }

    if (!lines.length) {
      this.showLyricsState('empty');
      return;
    }

    this.dom.lyricsLines.innerHTML = lines.map((ln, i) => {
      if (ln.t == null) return `<div class="lyric-line plain">${this.escapeHtml(ln.text)}</div>`;
      const inner = (doc.sync === 'word' && ln.words)
        ? ln.words.map((w) => `<span class="lw">${this.escapeHtml(w.text)}</span>`).join('')
        : this.escapeHtml(ln.text);
      return `<div class="lyric-line" data-line="${i}" data-time="${ln.t}">${inner}</div>`;
    }).join('');

    this.dom.lyricsState.style.display = 'none';
    this.dom.lyricsLines.querySelectorAll('.lyric-line[data-line]').forEach((el) => {
      this.lyricElsByIndex[parseInt(el.dataset.line, 10)] = el;
    });
    this.setLyricsFoot(`Lirik ${provider} · klik baris untuk melompat · ± geser waktu`);
    this.dom.lyricsScroll.scrollTop = 0;
    this.syncLyricsUI(this.player.currentTime || 0, true);
  }

  showLyricsState(kind) {
    const states = {
      idle: '<i class="fas fa-align-left"></i><p>Pilih lagu untuk melihat lirik</p><p class="sub">Lirik tersinkron dari Better Lyrics, LRC.RED &amp; LRCLIB</p>',
      loading: '<div class="lyrics-loading"><i class="fas fa-circle-notch fa-spin"></i></div><p>Mencari lirik…</p><p class="sub">Better Lyrics (utama) · LRC.RED · LRCLIB</p>',
      empty: '<i class="fas fa-microphone"></i><p>Lirik tidak tersedia untuk lagu ini</p><p class="sub">Coba tombol muat ulang atau pilih lagu lain.</p>',
      instrumental: '<i class="fas fa-music"></i><p>Lagu instrumental — tanpa lirik</p>',
    };
    this.dom.lyricsState.innerHTML = states[kind] || states.idle;
    this.dom.lyricsState.style.display = '';
    this.dom.lyricsLines.innerHTML = '';
    this.setLyricsFoot('');
    this.updateLyricsOffsetUI();
    this.lyricElsByIndex = {};
    this.lyricsActiveLine = -1;
    this.lyricsActiveWord = -1;
    if (kind === 'idle' || kind === 'loading' || kind === 'empty') this.dom.lyricsSource.innerHTML = '';
  }

  setLyricsFoot(text) {
    this.dom.lyricsFoot.textContent = text || '';
  }

  /** Sorot baris / kata yang sedang dinyanyikan. Dipanggil dari onTimeUpdate. */
  syncLyricsUI(t, force = false) {
    const doc = this.lyricsDoc;
    if (!doc || doc.instrumental || doc.sync === 'none' || !doc.lines || !doc.lines.length) return;
    if (!this.lyricsPaneVisible()) return;

    const lines = doc.lines;

    // Terapkan offset sinkronisasi (positif = lirik digeser lebih lambat).
    const ts = Math.max(0, t - this.lyricsOffset);

    // Baris aktif = baris terakhir yang mulai sebelum ts.
    let lo = 0;
    let hi = lines.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].t <= ts + 0.12) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (idx !== this.lyricsActiveLine || force) {
      const prev = this.lyricElsByIndex[this.lyricsActiveLine];
      if (prev) {
        prev.classList.remove('active');
        prev.querySelectorAll('.lw-on').forEach((sp) => sp.classList.remove('lw-on'));
      }
      const el = idx >= 0 ? this.lyricElsByIndex[idx] : null;
      if (el) {
        el.classList.add('active');
        if (Date.now() > this.lyricsScrollLockUntil) {
          el.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
        }
      }
      this.lyricsActiveLine = idx;
      this.lyricsActiveWord = -1;
    }

    // Sorotan per kata (mode karaoke Better Lyrics).
    if (doc.sync === 'word' && idx >= 0) {
      const line = lines[idx];
      const el = this.lyricElsByIndex[idx];
      if (line && line.words && el) {
        let wi = -1;
        for (let j = 0; j < line.words.length; j++) {
          const wt = line.words[j].t;
          if (wt == null || wt <= ts + 0.2) wi = j;
          else break;
        }
        if (wi !== this.lyricsActiveWord || force) {
          el.querySelectorAll('.lw').forEach((sp, j) => sp.classList.toggle('lw-on', j <= wi));
          this.lyricsActiveWord = wi;
        }
      }
    }
  }

  /**
   * Geser sinkronisasi lirik lagu ini. delta positif = lirik tampil lebih
   * lambat (solusi untuk video klip dengan intro). Offset disimpan per lagu.
   */
  nudgeLyricsOffset(delta, reset = false) {
    const doc = this.lyricsDoc;
    if (!doc || doc.instrumental || doc.sync === 'none' || !doc.lines || !doc.lines.length) return;
    if (!this.lyricsMetaKey) return;

    const next = reset ? 0 : Math.round((this.lyricsOffset + delta) * 10) / 10;
    const v = Math.max(-10, Math.min(10, next));
    if (v === this.lyricsOffset) return;

    this.lyricsOffset = v;
    this.lyrics.setOffset(this.lyricsMetaKey, v);
    this.updateLyricsOffsetUI();
    this.syncLyricsUI(this.player.currentTime || 0, true);
  }

  updateLyricsOffsetUI() {
    if (!this.dom.lyricsOffset) return;
    const doc = this.lyricsDoc;
    const show = !!(doc && doc.sync !== 'none' && !doc.instrumental && doc.lines && doc.lines.length);
    this.dom.lyricsOffset.style.display = show ? 'flex' : 'none';
    if (!show) return;

    const v = this.lyricsOffset;
    this.dom.lyrOffVal.textContent = `${v > 0 ? '+' : ''}${v.toFixed(1)} dtk`;
    this.dom.lyrOffVal.classList.toggle('set', v !== 0);
    this.dom.lyrOffMinus.disabled = v <= -10;
    this.dom.lyrOffPlus.disabled = v >= 10;
  }

  // --- Audio Events ---

  onTimeUpdate() {
    this.syncLyricsUI(this.player.currentTime || 0);
    const duration = this.player.duration;
    if (!duration) return;
    const ratio = this.player.currentTime / duration;
    this.dom.progressFill.style.width = `${ratio * 100}%`;
    this.dom.currentTime.textContent = this.formatTime(this.player.currentTime);
    this.dom.totalTime.textContent = this.formatTime(duration);
  }

  onLoadedMetadata() {
    const duration = this.player.duration;
    if (duration && this.tracks[this.currentIndex]) {
      this.tracks[this.currentIndex].duration = duration;
    }
    this.dom.totalTime.textContent = this.formatTime(duration);
    this.render();
  }

  onPlaying() {
    this.isPlaying = true;
    this.isLoadingTrack = false;
    this.embedSkipCount = 0;
    const track = this.tracks[this.currentIndex];
    if (track && track.isOnline) this.saveRecentOnline(track);
    this.updatePlayerUI();
    this.render();
    this.refreshSearchResults();
  }

  onPaused() {
    this.isPlaying = false;
    this.updatePlayerUI();
  }

  onTrackEnd() {
    if (this.repeatMode === 'one') {
      this.player.currentTime = 0;
      this.player.resume();
    } else {
      this.nextTrack();
    }
  }

  onLocalError() {
    this.isLoadingTrack = false;
    this.showToast('Gagal memuat file audio. Format tidak didukung.');
    this.nextTrack();
  }

  onStreamError() {
    // Stream putus di tengah lagu — lanjutkan lewat embed dengan lagu yang sama.
    const track = this.tracks[this.currentIndex];
    if (!track || !track.isOnline || this.streamFallbackAttempted) return;
    if (this.isLoadingTrack) return; // alur pemuatan normal sedang menangani ini
    this.streamFallbackAttempted = true;
    console.warn('[Player] Stream terputus, beralih ke embed…');
    this.isLoadingTrack = true;
    this.updatePlayerUI();
    this.player.playEmbed(track.videoId)
      .then(() => {
        this.isLoadingTrack = false;
        this.updatePlayerUI();
      })
      .catch(() => {
        this.isLoadingTrack = false;
        this.showToast('Streaming terputus. Coba lagu lain.');
        this.updatePlayerUI();
      });
  }

  onEmbedError(info) {
    const code = info && info.code;
    const videoId = info && info.videoId;
    const track = this.tracks[this.currentIndex];

    if (!track || !track.isOnline) return;
    // Abaikan laporan basi dari lagu yang sudah diganti.
    if (videoId && track.videoId && track.videoId !== videoId) return;

    console.warn('[Player] Embed error, kode:', code);
    this.isLoadingTrack = false;

    if (this.embedSkipCount >= 4) {
      this.isPlaying = false;
      this.embedSkipCount = 0;
      this.showToast('Beberapa lagu ini diblokir YouTube. Coba lagu lain.');
      this.updatePlayerUI();
      this.refreshSearchResults();
      return;
    }

    const next = this.getNextOnlineCandidate();
    if (!next) {
      this.isPlaying = false;
      this.showToast('Lagu ini tidak bisa diputar (dibatasi YouTube).');
      this.updatePlayerUI();
      this.refreshSearchResults();
      return;
    }

    this.embedSkipCount++;
    this.showToast('Lagu dibatasi YouTube — mencoba lagu berikutnya…');
    const queue = this.onlineQueue;
    this.playOnlineTrack(next, queue.length ? queue : null, true);
  }

  getNextOnlineCandidate() {
    const current = this.tracks[this.currentIndex];

    // 1) Dari daftar hasil pencarian/jelajahi yang sedang dilihat.
    if (this.onlineQueue.length && current) {
      const i = this.onlineQueue.findIndex(t => t.id === current.id);
      if (i >= 0 && i + 1 < this.onlineQueue.length) return this.onlineQueue[i + 1];
      return null;
    }

    // 2) Cadangan: lagu online berikutnya di daftar utama.
    for (let i = this.currentIndex + 1; i < this.tracks.length; i++) {
      const t = this.tracks[i];
      if (t.isOnline || t.source === 'youtube') return t;
    }
    return null;
  }

  handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'ArrowLeft':
        this.player.currentTime = Math.max(0, this.player.currentTime - 5);
        break;
      case 'ArrowRight':
        this.player.currentTime = Math.min(this.player.duration, this.player.currentTime + 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.volume = Math.min(1, this.volume + 0.05);
        this.player.setVolume(this.volume);
        this.updateVolumeUI();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.volume = Math.max(0, this.volume - 0.05);
        this.player.setVolume(this.volume);
        this.updateVolumeUI();
        break;
    }
  }

  switchPage(page) {
    this.dom.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    this.dom.pages.forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });
    if (page === 'search') this.dom.searchInput.focus();
    if (page === 'explore') this.dom.exploreSearchInput.focus();

    if (page === 'now') {
      this.renderNowPlaying();
      this.renderQueue();
      this.startNpVisualizer();
      if (this.nowTab === 'lyrics') this.ensureLyricsForCurrent();
    } else {
      this.stopNpVisualizer();
    }
    this.dom.lyricsBtn.classList.toggle('active', page === 'now' && this.nowTab === 'lyrics');
  }

  switchPlaylist(id, element) {
    this.activePlaylist = id;
    this.dom.playlistList.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    this.dom.trackListTitle.textContent = this.playlistNames[id] || 'Playlist';
    this.switchPage('home');
    this.renderTracks(id);
  }

  openPlaylistModal() {
    this.dom.playlistModal.classList.add('active');
    this.dom.playlistNameInput.value = '';
    this.dom.playlistNameInput.focus();
  }

  closePlaylistModal() {
    this.dom.playlistModal.classList.remove('active');
  }

  createPlaylist() {
    const name = this.dom.playlistNameInput.value.trim();
    if (!name) {
      this.showToast('Nama playlist tidak boleh kosong');
      return;
    }

    const id = 'playlist_' + Date.now();
    this.playlists[id] = [];
    this.playlistNames[id] = name;

    const item = document.createElement('div');
    item.className = 'playlist-item';
    item.dataset.playlist = id;
    item.innerHTML = `<i class="fas fa-list"></i><span>${this.escapeHtml(name)}</span>`;
    this.dom.playlistList.appendChild(item);

    item.addEventListener('click', () => this.switchPlaylist(id, item));

    this.closePlaylistModal();
    this.showToast(`Playlist "${name}" berhasil dibuat`);
  }

  // --- Rendering ---

  render() {
    this.renderTracks(this.activePlaylist);
    this.renderRecentCards();
    this.renderLibrary();
    this.updateCounts();
  }

  renderTracks(playlistId = 'all') {
    const tracks = playlistId && this.playlists[playlistId]
      ? this.playlists[playlistId]
      : this.playlists.all;

    const container = this.dom.trackList;
    if (!tracks.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-upload"></i>
          <p>${playlistId && playlistId !== 'all' ? 'Playlist masih kosong' : 'Belum ada lagu. Tambahkan file musik atau jelajahi musik online!'}</p>
        </div>`;
      return;
    }

    container.innerHTML = tracks.map((track, i) => {
      const idx = this.tracks.indexOf(track);
      const isPlaying = idx === this.currentIndex && this.isPlaying;
      const duration = track.duration ? this.formatTime(track.duration) : '--:--';
      const isOnline = track.isOnline || track.source === 'youtube';
      const srcBadge = isOnline ? '<span class="track-source">YouTube</span>' : '';

      return `
        <div class="track-item ${isPlaying ? 'playing' : ''}" data-index="${idx}" data-playlist="${playlistId}">
          <span class="track-index">${isPlaying ? '<i class="fas fa-volume-up" style="color:var(--accent-primary)"></i>' : (i + 1)}</span>
          <div class="track-info">
            <div class="track-name">${this.escapeHtml(track.title)} ${srcBadge}</div>
            <div class="track-artist-name">${this.escapeHtml(track.artist)}</div>
          </div>
          <span class="track-duration">${duration}</span>
          <div class="track-actions">
            <button class="track-queue-btn" data-id="${track.id}" title="Tambahkan ke antrean">
              <i class="fas fa-plus"></i>
            </button>
            <button class="track-like-btn" data-id="${track.id}" title="Sukai">
              <i class="${track.liked ? 'fas' : 'far'} fa-heart"></i>
            </button>
            <button class="track-dl-btn" data-id="${track.id}" title="Download">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.track-actions')) return;
        const idx = parseInt(el.dataset.index);
        if (!isNaN(idx)) {
          this.playTrack(idx);
          this.openQueuePage();
        }
      });
    });

    container.querySelectorAll('.track-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (track) this.addToQueue(track);
      });
    });

    container.querySelectorAll('.track-like-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (track) {
          track.liked = !track.liked;
          if (track.liked) {
            if (!this.playlists.liked.find(t2 => t2.id === track.id)) {
              this.playlists.liked.push(track);
            }
          } else {
            this.playlists.liked = this.playlists.liked.filter(t2 => t2.id !== track.id);
          }
          this.saveLiked();
          this.render();
          this.updatePlayerUI();
        }
      });
    });

    container.querySelectorAll('.track-dl-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (!track) return;
        if (track.isOnline || track.source === 'youtube') {
          this.downloadOnlineTrack(track);
          return;
        }
        const a = document.createElement('a');
        a.href = track.url;
        a.download = (track.artist !== 'Artis Tidak Diketahui' ? track.artist + ' - ' : '') + track.title + '.mp3';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this.showToast(`Mendownload: ${track.title}`);
      });
    });
  }

  renderRecentCards() {
    const tracks = this.tracks.slice(-8).reverse();
    const container = this.dom.recentTracks;

    if (!tracks.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-music"></i>
          <p>Belum ada musik. Tambahkan lagu lokal atau jelajahi online!</p>
        </div>`;
      return;
    }

    container.innerHTML = tracks.map(track => {
      const idx = this.tracks.indexOf(track);
      return `
        <div class="music-card" data-index="${idx}">
          <div class="music-card-cover">
            <i class="fas fa-music"></i>
            <div class="play-overlay">
              <i class="fas fa-play-circle"></i>
            </div>
          </div>
          <div class="music-card-title">${this.escapeHtml(track.title)}</div>
          <div class="music-card-artist">${this.escapeHtml(track.artist)}</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.music-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.index);
        if (!isNaN(idx)) {
          this.playTrack(idx);
          this.openQueuePage();
        }
      });
    });
  }

  renderLibrary(filter = 'all') {
    const container = this.dom.libraryGrid;
    const localTracks = this.tracks.filter(t => t.source !== 'youtube' && !t.isOnline);

    if (!localTracks.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-book"></i>
          <p>Tidak ada musik lokal. Tambahkan file dari komputermu.</p>
        </div>`;
      return;
    }

    if (filter === 'artist') {
      const artists = {};
      localTracks.forEach(t => {
        if (!artists[t.artist]) artists[t.artist] = [];
        artists[t.artist].push(t);
      });
      container.innerHTML = Object.entries(artists).map(([artist, tracks]) => `
        <div class="library-item">
          <i class="fas fa-user"></i>
          <div class="lib-name">${this.escapeHtml(artist)}</div>
          <div class="lib-count">${tracks.length} lagu</div>
        </div>
      `).join('');
    } else if (filter === 'album') {
      const albums = {};
      localTracks.forEach(t => {
        if (!albums[t.album]) albums[t.album] = [];
        albums[t.album].push(t);
      });
      container.innerHTML = Object.entries(albums).map(([album, tracks]) => `
        <div class="library-item">
          <i class="fas fa-compact-disc"></i>
          <div class="lib-name">${this.escapeHtml(album)}</div>
          <div class="lib-count">${tracks.length} lagu</div>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <div class="library-item">
          <i class="fas fa-music"></i>
          <div class="lib-name">Semua Lagu</div>
          <div class="lib-count">${localTracks.length} lagu</div>
        </div>
        <div class="library-item">
          <i class="fas fa-user"></i>
          <div class="lib-name">Artis</div>
          <div class="lib-count">${new Set(localTracks.map(t => t.artist)).size} artis</div>
        </div>
        <div class="library-item">
          <i class="fas fa-compact-disc"></i>
          <div class="lib-name">Album</div>
          <div class="lib-count">${new Set(localTracks.map(t => t.album)).size} album</div>
        </div>`;
    }
  }

  // --- Pencarian (halaman Cari): pustaka lokal + online ---

  onSearchInput() {
    const query = this.dom.searchInput.value.trim();
    clearTimeout(this.searchDebounceId);

    if (!query) {
      this.searchToken++; // batalkan hasil online yang sedang diproses
      this.renderSearchIdle();
      return;
    }

    this.ensureSearchSkeleton();
    this.renderSearchLocalPart(query);

    if (query.length < 2) {
      this.renderSearchOnlineHint();
      return;
    }

    this.renderSearchOnlineLoading();

    // Tunggu sampai ketikan berhenti sebentar, baru panggil server.
    this.searchDebounceId = setTimeout(() => this.runOnlineSearch(), 650);
  }

  async runOnlineSearch() {
    const query = this.dom.searchInput.value.trim();

    if (query.length < 2) {
      this.renderSearchOnlineHint();
      return;
    }

    this.ensureSearchSkeleton();
    this.renderSearchLocalPart(query);
    const token = ++this.searchToken;
    this.renderSearchOnlineLoading();

    try {
      const tracks = await this.youtube.search(query, 30);
      if (token !== this.searchToken) return; // sudah ada pencarian yang lebih baru
      this.searchOnlineResults = tracks;
      this.renderSearchOnlinePart(query, tracks);
    } catch (err) {
      if (token !== this.searchToken) return;
      console.warn('[Search] Gagal mencari online:', err);
      this.renderSearchOnlinePart(query, null);
    }
  }

  renderSearchIdle() {
    this.searchOnlineResults = [];
    this.searchArtists = [];
    this.dom.searchResults.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search"></i>
        <p>Cari lagu dari pustaka lokal dan online</p>
      </div>`;
  }

  ensureSearchSkeleton() {
    if (this.dom.searchResults.querySelector('#searchOnlineResults')) return;

    this.dom.searchResults.innerHTML = `
      <div class="search-section" id="searchLocalSection" style="display:none">
        <div class="section-header">
          <h2>Pustaka Kamu</h2>
          <span class="track-count" id="searchLocalCount"></span>
        </div>
        <div class="track-list" id="searchLocalResults"></div>
      </div>
      <div class="search-section" id="searchArtistsSection" style="display:none">
        <div class="section-header">
          <h2>Artis</h2>
          <span class="track-count" id="searchArtistsCount"></span>
        </div>
        <div class="artist-row" id="searchArtistsRow"></div>
      </div>
      <div class="search-section">
        <div class="section-header">
          <h2>Hasil Online</h2>
          <span class="track-count" id="searchOnlineCount"></span>
        </div>
        <div class="track-list" id="searchOnlineResults"></div>
      </div>`;
  }

  renderSearchLocalPart(query) {
    const section = document.getElementById('searchLocalSection');
    const list = document.getElementById('searchLocalResults');
    const count = document.getElementById('searchLocalCount');
    if (!section || !list || !count) return;

    const q = query.toLowerCase();
    const results = this.tracks.filter(t =>
      !t.isOnline && t.source !== 'youtube' &&
      (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
    );

    if (!results.length) {
      section.style.display = 'none';
      list.innerHTML = '';
      count.textContent = '';
      return;
    }

    section.style.display = '';
    count.textContent = `${results.length} hasil`;

    list.innerHTML = results.map(track => {
      const idx = this.tracks.indexOf(track);
      const isPlaying = idx === this.currentIndex;

      return `
        <div class="track-item ${isPlaying ? 'playing' : ''}" data-index="${idx}">
          <span class="track-index">${isPlaying ? '<i class="fas fa-volume-up" style="color:var(--accent-primary)"></i>' : '<i class="fas fa-music"></i>'}</span>
          <div class="track-info">
            <div class="track-name">${this.highlightMatch(this.escapeHtml(track.title), query)}</div>
            <div class="track-artist-name">${this.highlightMatch(this.escapeHtml(track.artist), query)}</div>
          </div>
          <span class="track-duration">${track.duration ? this.formatTime(track.duration) : '--:--'}</span>
          <div class="track-actions">
            <button class="track-queue-btn" data-id="${track.id}" title="Tambahkan ke antrean">
              <i class="fas fa-plus"></i>
            </button>
            <button class="track-like-btn" data-id="${track.id}" title="Sukai">
              <i class="${track.liked ? 'fas' : 'far'} fa-heart"></i>
            </button>
            <button class="track-dl-btn" data-id="${track.id}" title="Download">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.track-actions')) return;
        const idx = parseInt(el.dataset.index);
        if (!isNaN(idx)) {
          this.playTrack(idx);
          this.openQueuePage();
        }
      });
    });

    list.querySelectorAll('.track-queue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (track) this.addToQueue(track);
      });
    });

    list.querySelectorAll('.track-like-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (track) {
          track.liked = !track.liked;
          if (track.liked) {
            if (!this.playlists.liked.find(t2 => t2.id === track.id)) {
              this.playlists.liked.push(track);
            }
          } else {
            this.playlists.liked = this.playlists.liked.filter(t2 => t2.id !== track.id);
          }
          this.saveLiked();
          this.render();
          this.updatePlayerUI();
        }
      });
    });

    list.querySelectorAll('.track-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (!track) return;
        const a = document.createElement('a');
        a.href = track.url;
        a.download = (track.artist !== 'Artis Tidak Diketahui' ? track.artist + ' - ' : '') + track.title + '.mp3';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this.showToast(`Mendownload: ${track.title}`);
      });
    });
  }

  renderSearchOnlineHint() {
    const list = document.getElementById('searchOnlineResults');
    const count = document.getElementById('searchOnlineCount');
    if (!list || !count) return;
    count.textContent = '';
    list.innerHTML = '<div class="empty-state"><i class="fas fa-keyboard"></i><p>Ketik minimal 2 huruf untuk mencari online…</p></div>';
    this.hideSearchArtists();
  }

  renderSearchOnlineLoading() {
    const list = document.getElementById('searchOnlineResults');
    const count = document.getElementById('searchOnlineCount');
    if (!list || !count) return;
    count.textContent = '';
    list.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner"></i><p>Mencari online...</p></div>';
    this.hideSearchArtists();
  }

  hideSearchArtists() {
    const section = document.getElementById('searchArtistsSection');
    if (section) section.style.display = 'none';
  }

  renderSearchOnlinePart(query, tracks) {
    const list = document.getElementById('searchOnlineResults');
    const count = document.getElementById('searchOnlineCount');
    if (!list || !count) return;

    if (tracks === null) {
      count.textContent = '';
      list.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Gagal mencari lagu online.</p>
          <p style="font-size:13px;margin-top:8px">Semua server publik sedang sibuk — coba lagi sebentar lagi.</p>
        </div>`;
      this.hideSearchArtists();
      return;
    }

    if (!tracks.length) {
      count.textContent = '0 hasil';
      list.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>Tidak ditemukan hasil untuk "${this.escapeHtml(query)}"</p></div>`;
      this.hideSearchArtists();
      return;
    }

    count.textContent = `${tracks.length} hasil`;

    list.innerHTML = tracks.map((track, i) => this.onlineRowHtml(track, i, query)).join('');
    this.wireOnlineRows(list, tracks, query);
    this.renderSearchArtists(tracks);
  }

  // --- Artis di halaman pencarian ---

  renderSearchArtists(tracks) {
    const section = document.getElementById('searchArtistsSection');
    const row = document.getElementById('searchArtistsRow');
    const count = document.getElementById('searchArtistsCount');
    if (!section || !row || !count) return;

    const map = new Map();
    for (const t of tracks) {
      const name = (t.artist || '').trim();
      if (!name || name.length < 2 || /unknown/i.test(name)) continue;
      const e = map.get(name) || { name, n: 0, artwork: null };
      e.n++;
      if (!e.artwork && t.artwork) e.artwork = t.artwork;
      map.set(name, e);
    }

    this.searchArtists = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 8);

    if (!this.searchArtists.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    count.textContent = `${this.searchArtists.length} artis`;

    row.innerHTML = this.searchArtists.map((a, i) => `
      <div class="artist-chip" data-artist-index="${i}">
        <div class="artist-chip-avatar">
          ${a.artwork ? `<img src="${a.artwork}" alt="" loading="lazy" onerror="this.remove()">` : '<i class="fas fa-user"></i>'}
        </div>
        <div class="artist-chip-info">
          <div class="artist-chip-name">${this.escapeHtml(a.name)}</div>
          <div class="artist-chip-count">${a.n} lagu</div>
        </div>
      </div>`).join('');

    row.querySelectorAll('.artist-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.artistIndex, 10);
        const artist = this.searchArtists[idx];
        if (artist) this.openArtistPage(artist.name);
      });
    });
  }

  async openArtistPage(name) {
    const container = this.dom.searchResults;
    const artistInfo = this.searchArtists.find(a => a.name === name) || { artwork: null };

    container.innerHTML = `
      <div class="artist-page">
        <button class="artist-back-btn" id="artistBackBtn">
          <i class="fas fa-arrow-left"></i> Kembali ke pencarian
        </button>
        <div class="artist-hero">
          <div class="artist-hero-avatar">
            ${artistInfo.artwork ? `<img src="${artistInfo.artwork}" alt="" onerror="this.remove()">` : '<i class="fas fa-user"></i>'}
          </div>
          <div class="artist-hero-info">
            <div class="artist-hero-label">Artis</div>
            <h2>${this.escapeHtml(name)}</h2>
            <p id="artistSongCount">Memuat lagu…</p>
          </div>
        </div>
        <div class="track-list" id="artistTrackList">
          <div class="loading-spinner"><i class="fas fa-spinner"></i><p>Memuat lagu…</p></div>
        </div>
      </div>`;

    document.getElementById('artistBackBtn').addEventListener('click', () => this.closeArtistPage());

    let tracks = [];
    try {
      tracks = await this.youtube.search(`${name} top songs`, 30);
    } catch (err) {
      console.warn('[Artist] Gagal memuat lagu artis:', err && err.message);
      tracks = [];
    }

    const list = document.getElementById('artistTrackList');
    const countEl = document.getElementById('artistSongCount');
    if (!list || !document.body.contains(list)) return; // pengguna sudah menekan kembali

    // Lagu yang benar-benar dari artis ini tampil lebih dulu.
    tracks.sort((a, b) => (b.artist === name ? 1 : 0) - (a.artist === name ? 1 : 0));

    countEl.textContent = `${tracks.length} lagu (dari pencarian online)`;

    if (!tracks.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>Tidak ada lagu ditemukan untuk artis ini.</p></div>';
      return;
    }

    this.artistTracks = tracks;
    list.innerHTML = tracks.map((track, i) => this.onlineRowHtml(track, i)).join('');
    this.wireOnlineRows(list, tracks);
  }

  closeArtistPage() {
    // Kembalikan tampilan pencarian — hasil online diambil dari cache,
    // jadi tampil instan.
    this.ensureSearchSkeleton();
    this.onSearchInput();
    this.runOnlineSearch();
  }

  refreshSearchResults() {
    const query = this.dom.searchInput.value.trim();
    if (!query) return;
    if (!this.dom.searchResults.querySelector('#searchOnlineResults')) return;

    this.renderSearchLocalPart(query);
    if (this.searchOnlineResults.length) {
      this.renderSearchOnlinePart(query, this.searchOnlineResults);
    }
  }

  highlightMatch(text, query) {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark style="background:rgba(59,130,246,0.3);color:#93c5fd;padding:0 2px;border-radius:2px">$1</mark>');
  }

  updatePlayerUI() {
    const track = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;

    if (track) {
      this.dom.nowPlayingTitle.textContent = track.title;
      const suffix = (track.isOnline ? ' · YouTube' : '') + (this.isLoadingTrack ? ' · memuat…' : '');
      this.dom.nowPlayingArtist.textContent = track.artist + suffix;
      this.dom.likeBtn.innerHTML = track.liked
        ? '<i class="fas fa-heart"></i>'
        : '<i class="far fa-heart"></i>';
      this.dom.likeBtn.classList.toggle('liked', track.liked);
    } else {
      this.dom.nowPlayingTitle.textContent = 'Belum ada lagu';
      this.dom.nowPlayingArtist.textContent = 'Tambahkan musik atau streaming online';
    }

    this.dom.playBtn.innerHTML = this.isPlaying
      ? '<i class="fas fa-pause"></i>'
      : '<i class="fas fa-play"></i>';

    // Halaman Antrean / Sekarang Diputar.
    this.renderNowPlaying();
    this.renderQueue();
    if (this.lyricsPaneVisible()) this.ensureLyricsForCurrent();
  }

  updateVolumeUI() {
    const icon = this.isMuted ? 'volume-mute'
      : this.volume > 0.5 ? 'volume-up'
      : this.volume > 0 ? 'volume-down' : 'volume-off';

    this.dom.muteBtn.innerHTML = `<i class="fas fa-${icon}"></i>`;
    this.dom.volumeFill.style.width = `${(this.isMuted ? 0 : this.volume) * 100}%`;
  }

  updateCounts() {
    const localCount = this.tracks.filter(t => t.source !== 'youtube' && !t.isOnline).length;
    this.dom.trackCount.textContent = `${localCount} lagu lokal`;
  }

  // --- Visualizer ---

  toggleVisualizer() {
    this.visualizerActive = !this.visualizerActive;
    this.dom.visualizerOverlay.classList.toggle('active');

    if (this.visualizerActive) {
      this.startVisualizer();
    } else {
      this.stopVisualizer();
    }
  }

  startVisualizer() {
    const canvas = this.dom.visualizerCanvas;
    if (!canvas || this.animFrameId) return;

    const draw = () => {
      this.animFrameId = requestAnimationFrame(draw);
      this.drawBarsFrame(canvas, {
        bars: Math.max(32, Math.floor(canvas.width / 9)),
        gap: 2,
        rounded: false,
        trail: 0.3,
        trailColor: 'rgba(0, 0, 0,',
        heightScale: 0.8,
        speed: 0.8,
        active: this.isPlaying ? 1 : 0.22,
        colors: ['rgba(30, 64, 175, 0.9)', 'rgba(59, 130, 246, 0.9)', 'rgba(147, 197, 253, 0.95)'],
      });
    };

    draw();
  }

  stopVisualizer() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  // --- Utilities ---

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  showToast(message) {
    this.dom.toast.textContent = message;
    this.dom.toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.dom.toast.classList.remove('show');
    }, 3000);
  }

  // --- State Persistence ---

  saveRecentOnline(track) {
    try {
      let recents = this.getRecentOnline();
      recents = recents.filter(t => t.id !== track.id);
      recents.unshift({
        id: track.id,
        videoId: track.videoId,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork || null,
        duration: track.duration || 0,
        source: 'youtube',
        isOnline: true,
      });
      localStorage.setItem('bluesync_online_recents', JSON.stringify(recents.slice(0, 12)));
    } catch (e) { /* storage tidak tersedia */ }
  }

  getRecentOnline() {
    try {
      const raw = localStorage.getItem('bluesync_online_recents');
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  saveState() {
    try {
      const state = {
        volume: this.volume,
        shuffleOn: this.shuffleOn,
        repeatMode: this.repeatMode,
      };
      sessionStorage.setItem('bluesync_state', JSON.stringify(state));
    } catch (e) {
      // Storage not available
    }
  }

  loadState() {
    try {
      const saved = sessionStorage.getItem('bluesync_state');
      if (saved) {
        const state = JSON.parse(saved);
        this.volume = state.volume || 0.7;
        this.shuffleOn = state.shuffleOn || false;
        this.repeatMode = state.repeatMode || 'off';
        this.player.setVolume(this.volume);
        this.updateVolumeUI();
        if (this.shuffleOn) this.dom.shuffleBtn.classList.add('active');
      }
    } catch (e) {
      // Ignore
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new MusicPlayer();
});
