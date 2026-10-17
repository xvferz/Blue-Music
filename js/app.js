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
    this.youtube = new YouTubeMusicAPI();
    this.activePlaylist = 'all';
    this.searchDebounceId = null;
    this.searchToken = 0;
    this.searchOnlineResults = [];
    this.onlineQueue = [];
    this.embedSkipCount = 0;

    this.init();
  }

  init() {
    this.cacheDOM();
    this.bindEvents();
    this.loadState();
    this.setupAudioContext();
    this.render();
    this.updatePlayerUI();
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

    this.dom.progressBar.addEventListener('click', (e) => this.seek(e));
    this.dom.volumeBar.addEventListener('click', (e) => this.setVolume(e));

    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    this.dom.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchPage(item.dataset.page);
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
            <div class="play-overlay">
              <i class="fas fa-play-circle"></i>
            </div>
          </div>
          <div class="music-card-title">${this.escapeHtml(track.title)}</div>
          <div class="music-card-artist">${this.escapeHtml(track.artist)}</div>
          <span class="source-badge online"><i class="fab fa-youtube"></i> YouTube</span>
        </div>`;
    }).join('');

    container.querySelectorAll('.online-card').forEach(card => {
      card.addEventListener('click', () => {
        const onlineId = card.dataset.onlineId;
        const track = this.onlineTracks.find(t => t.id === onlineId);
        if (track) this.playOnlineTrack(track, this.onlineTracks);
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

      container.innerHTML = tracks.map((track, i) => {
        const duration = track.duration ? this.formatTime(track.duration) : '--:--';
        return `
          <div class="track-item" data-online-id="${track.id}">
            <span class="track-index">${i + 1}</span>
            <div class="track-info">
              <div class="track-name">${this.highlightMatch(this.escapeHtml(track.title), query)}</div>
              <div class="track-artist-name">${this.highlightMatch(this.escapeHtml(track.artist), query)} <span class="track-source">YouTube</span></div>
            </div>
            <span class="track-duration">${duration}</span>
          </div>`;
      }).join('');

      container.querySelectorAll('.track-item').forEach(el => {
        el.addEventListener('click', (e) => {
          const track = this.onlineTracks.find(t => t.id === el.dataset.onlineId);
          if (track) this.playOnlineTrack(track, this.onlineTracks);
        });
      });
      
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

  async downloadOnlineTrack(track) {
    this.showToast('Download hanya tersedia untuk musik lokal.');
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
    this.render();
  }

  seek(e) {
    const rect = this.dom.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.player.currentTime = ratio * this.player.duration;
  }

  setVolume(e) {
    const rect = this.dom.volumeBar.getBoundingClientRect();
    this.volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.player.setVolume(this.volume);
    this.updateVolumeUI();
  }

  downloadTrack() {
    if (this.currentIndex === -1 || !this.tracks[this.currentIndex]) {
      this.showToast('Tidak ada lagu yang dipilih');
      return;
    }

    const track = this.tracks[this.currentIndex];
    if (track.isOnline) {
      this.showToast('Download hanya tersedia untuk musik lokal.');
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

  // --- Audio Events ---

  onTimeUpdate() {
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
  }

  switchPlaylist(id, element) {
    this.activePlaylist = id;
    this.dom.playlistList.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
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

    const item = document.createElement('div');
    item.className = 'playlist-item';
    item.dataset.playlist = id;
    item.innerHTML = `<i class="fas fa-list"></i><span>${this.escapeHtml(name)}</span>`;
    this.dom.playlistList.appendChild(item);

    item.addEventListener('click', () => {
      this.dom.playlistList.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      this.renderTracks(id);
    });

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
      const srcBadge = track.source === 'youtube' || track.isOnline
        ? '<span class="track-source">YouTube</span>'
        : '';

      return `
        <div class="track-item ${isPlaying ? 'playing' : ''}" data-index="${idx}" data-playlist="${playlistId}">
          <span class="track-index">${isPlaying ? '<i class="fas fa-volume-up" style="color:var(--accent-primary)"></i>' : (i + 1)}</span>
          <div class="track-info">
            <div class="track-name">${this.escapeHtml(track.title)} ${srcBadge}</div>
            <div class="track-artist-name">${this.escapeHtml(track.artist)}</div>
          </div>
          <span class="track-duration">${duration}</span>
          <div class="track-actions">
            <button class="track-like-btn" data-id="${track.id}" title="Sukai">
              <i class="${track.liked ? 'fas' : 'far'} fa-heart"></i>
            </button>
            ${track.isOnline || track.source === 'youtube' ? '' : `
            <button class="track-dl-btn" data-id="${track.id}" title="Download">
              <i class="fas fa-download"></i>
            </button>`}
          </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.track-actions')) return;
        const idx = parseInt(el.dataset.index);
        if (!isNaN(idx)) this.playTrack(idx);
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
          this.render();
          this.updatePlayerUI();
        }
      });
    });

    container.querySelectorAll('.track-dl-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (track && !track.isOnline && track.source !== 'youtube') {
          const a = document.createElement('a');
          a.href = track.url;
          a.download = track.title + '.mp3';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
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
        if (!isNaN(idx)) this.playTrack(idx);
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
            <button class="track-like-btn" data-id="${track.id}">
              <i class="${track.liked ? 'fas' : 'far'} fa-heart"></i>
            </button>
            <button class="track-dl-btn" data-id="${track.id}">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.track-actions')) return;
        const idx = parseInt(el.dataset.index);
        if (!isNaN(idx)) this.playTrack(idx);
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
          this.render();
          this.updatePlayerUI();
        }
      });
    });

    list.querySelectorAll('.track-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = this.tracks.find(t => t.id === btn.dataset.id);
        if (track && !track.isOnline && track.source !== 'youtube') {
          const a = document.createElement('a');
          a.href = track.url;
          a.download = track.title + '.mp3';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      });
    });
  }

  renderSearchOnlineHint() {
    const list = document.getElementById('searchOnlineResults');
    const count = document.getElementById('searchOnlineCount');
    if (!list || !count) return;
    count.textContent = '';
    list.innerHTML = '<div class="empty-state"><i class="fas fa-keyboard"></i><p>Ketik minimal 2 huruf untuk mencari online…</p></div>';
  }

  renderSearchOnlineLoading() {
    const list = document.getElementById('searchOnlineResults');
    const count = document.getElementById('searchOnlineCount');
    if (!list || !count) return;
    count.textContent = '';
    list.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner"></i><p>Mencari online...</p></div>';
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
      return;
    }

    if (!tracks.length) {
      count.textContent = '0 hasil';
      list.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>Tidak ditemukan hasil untuk "${this.escapeHtml(query)}"</p></div>`;
      return;
    }

    count.textContent = `${tracks.length} hasil`;

    const current = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;

    list.innerHTML = tracks.map((track, i) => {
      const duration = track.duration ? this.formatTime(track.duration) : '--:--';
      const isPlaying = current && current.id === track.id;

      return `
        <div class="track-item ${isPlaying ? 'playing' : ''}" data-online-id="${track.id}">
          <span class="track-index">${isPlaying ? '<i class="fas fa-volume-up" style="color:var(--accent-primary)"></i>' : (i + 1)}</span>
          <div class="track-info">
            <div class="track-name">${this.highlightMatch(this.escapeHtml(track.title), query)}</div>
            <div class="track-artist-name">${this.highlightMatch(this.escapeHtml(track.artist), query)} <span class="track-source">YouTube</span></div>
          </div>
          <span class="track-duration">${duration}</span>
        </div>`;
    }).join('');

    list.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', () => {
        const track = this.searchOnlineResults.find(t => t.id === el.dataset.onlineId);
        if (track) this.playOnlineTrack(track, this.searchOnlineResults);
      });
    });
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
    if (!this.visualizerActive) {
      const current = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
      if (current && current.isOnline) {
        this.showToast('Visualizer hanya bekerja untuk musik lokal');
        return;
      }
    }

    this.visualizerActive = !this.visualizerActive;
    this.dom.visualizerOverlay.classList.toggle('active');

    if (this.visualizerActive && this.analyser) {
      this.startVisualizer();
    } else {
      this.stopVisualizer();
    }
  }

  startVisualizer() {
    const canvas = this.dom.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      this.animFrameId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#1e40af');
        gradient.addColorStop(0.5, '#3b82f6');
        gradient.addColorStop(1, '#93c5fd');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
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
  new MusicPlayer();
});
