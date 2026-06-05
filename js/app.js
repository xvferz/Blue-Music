class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.tracks = [];
    this.onlineTracks = [];
    this.playlists = { all: [], liked: [] };
    this.currentIndex = -1;
    this.isPlaying = false;
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
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.audio.addEventListener('ended', () => this.onTrackEnd());
    this.audio.addEventListener('error', () => this.onAudioError());

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

    this.dom.searchInput.addEventListener('input', () => this.searchLocal());

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
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.srcNode = this.audioCtx.createMediaElementSource(this.audio);
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
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-cloud-upload-alt"></i>
          <p>Gagal terhubung ke server YouTube.</p>
          <p style="font-size:13px;margin-top:8px">Coba refresh halaman atau gunakan <strong>Cari</strong> di atas untuk mencari lagu.</p>
        </div>`;
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
        if (track) this.playOnlineTrack(track);
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
            <div class="track-actions">
              <button class="track-dl-btn" data-online-id="${track.id}" title="Download">
                <i class="fas fa-download"></i>
              </button>
            </div>
          </div>`;
      }).join('');

      container.querySelectorAll('.track-item').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.track-actions')) return;
          const track = this.onlineTracks.find(t => t.id === el.dataset.onlineId);
          if (track) this.playOnlineTrack(track);
        });
      });

      container.querySelectorAll('.track-dl-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const track = this.onlineTracks.find(t => t.id === btn.dataset.onlineId);
          if (track) await this.downloadOnlineTrack(track);
        });
      });
      
    } catch (error) {
      // TAMPILKAN PESAN ERROR JIKA GAGAL
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Gagal mencari lagu.</p>
          <p style="font-size:13px;margin-top:8px">Pastikan koneksi internet stabil atau coba lagi nanti.</p>
        </div>`;
      console.error(error);
    }
  }
  async playOnlineTrack(track) {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    let streamUrl;
    try {
      streamUrl = await this.youtube.getAudioStreamUrl(track.videoId);
    } catch (err) {
      this.showToast('Gagal mendapatkan stream audio. Coba lagu lain.');
      return;
    }

    const localTrack = {
      ...track,
      source: 'youtube',
      url: streamUrl,
      streamUrl: streamUrl,
      isOnline: true,
    };

    if (!this.tracks.find(t => t.id === track.id)) {
      this.tracks.push(localTrack);
      this.playlists.all.push(localTrack);
    }

    const found = this.tracks.find(t => t.id === track.id);
    this.currentIndex = this.tracks.indexOf(found || localTrack);
    if (this.currentIndex === -1) this.currentIndex = this.tracks.length - 1;

    this.audio.src = streamUrl;
    this.audio.crossOrigin = 'anonymous';
    this.audio.load();

    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (err) {
      this.showToast('Gagal memutar. Coba lagu lain atau refresh halaman.');
      return;
    }

    this.updatePlayerUI();
    this.render();
  }

  async downloadOnlineTrack(track) {
    this.showToast(`Mengunduh ${track.title}...`);

    try {
      const blob = await this.youtube.downloadAudio(track.videoId);
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${track.artist} - ${track.title}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.showToast(`Terunduh: ${track.title}`);
    } catch (err) {
      this.showToast('Gagal mengunduh. Coba lagi.');
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
      this.playOnlineTrack(this.onlineTracks.find(t2 => t2.id === track.id) || track);
      return;
    }

    this.audio.src = track.url;
    this.audio.load();
    this.audio.play()
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
      this.audio.pause();
      this.isPlaying = false;
    } else {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.audio.play()
        .then(() => { this.isPlaying = true; })
        .catch((err) => { console.warn('Gagal memutar:', err); });
    }
    this.updatePlayerUI();
    this.render();
  }

  prevTrack() {
    if (this.tracks.length === 0) return;

    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
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
    this.audio.muted = this.isMuted;
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
    this.audio.currentTime = ratio * this.audio.duration;
  }

  setVolume(e) {
    const rect = this.dom.volumeBar.getBoundingClientRect();
    this.volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.audio.volume = this.volume;
    this.updateVolumeUI();
  }

  downloadTrack() {
    if (this.currentIndex === -1 || !this.tracks[this.currentIndex]) {
      this.showToast('Tidak ada lagu yang dipilih');
      return;
    }

    const track = this.tracks[this.currentIndex];
    if (track.isOnline) {
      this.downloadOnlineTrack(this.onlineTracks.find(t2 => t2.id === track.id) || track);
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
    if (!this.audio.duration) return;
    const ratio = this.audio.currentTime / this.audio.duration;
    this.dom.progressFill.style.width = `${ratio * 100}%`;
    this.dom.currentTime.textContent = this.formatTime(this.audio.currentTime);
  }

  onLoadedMetadata() {
    this.dom.totalTime.textContent = this.formatTime(this.audio.duration);
    if (this.tracks[this.currentIndex]) {
      this.tracks[this.currentIndex].duration = this.audio.duration;
    }
    this.render();
  }

  onTrackEnd() {
    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
    } else {
      this.nextTrack();
    }
  }

  onAudioError() {
    const track = this.tracks[this.currentIndex];
    if (track && track.isOnline) {
      this.showToast('Gagal streaming dari YouTube. Coba lagu lain atau refresh.');
      if (this.audio.src) {
        this.audio.src = '';
      }
    } else {
      this.showToast('Gagal memuat file audio. Format tidak didukung.');
    }
    this.nextTrack();
  }

  handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'ArrowLeft':
        this.audio.currentTime = Math.max(0, this.audio.currentTime - 5);
        break;
      case 'ArrowRight':
        this.audio.currentTime = Math.min(this.audio.duration, this.audio.currentTime + 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.volume = Math.min(1, this.volume + 0.05);
        this.audio.volume = this.volume;
        this.updateVolumeUI();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.volume = Math.max(0, this.volume - 0.05);
        this.audio.volume = this.volume;
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
        if (track) {
          if (track.isOnline || track.source === 'youtube') {
            const ot = this.onlineTracks.find(t2 => t2.id === track.id);
            if (ot) await this.downloadOnlineTrack(ot);
          } else {
            const a = document.createElement('a');
            a.href = track.url;
            a.download = track.title + '.mp3';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
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

  searchLocal() {
    const query = this.dom.searchInput.value.toLowerCase().trim();
    const container = this.dom.searchResults;

    if (!query) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-search"></i>
          <p>Cari lagu dari pustaka lokal dan online</p>
        </div>`;
      return;
    }

    const results = this.tracks.filter(t =>
      !t.isOnline && t.source !== 'youtube' &&
      (t.title.toLowerCase().includes(query) ||
       t.artist.toLowerCase().includes(query))
    );

    if (!results.length) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-search"></i>
          <p>Tidak ditemukan hasil untuk "${this.escapeHtml(query)}"</p>
          <p style="margin-top:8px;font-size:13px">Coba cari di <a href="#" onclick="document.querySelector('[data-page=explore]').click();setTimeout(()=>document.getElementById('exploreSearchInput').value='${this.escapeHtml(query)}',100)" style="color:var(--accent-primary)">Jelajahi Online</a></p>
        </div>`;
      return;
    }

    container.innerHTML = results.map(track => {
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
        if (track) {
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

  highlightMatch(text, query) {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark style="background:rgba(59,130,246,0.3);color:#93c5fd;padding:0 2px;border-radius:2px">$1</mark>');
  }

  updatePlayerUI() {
    const track = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;

    if (track) {
      this.dom.nowPlayingTitle.textContent = track.title;
      this.dom.nowPlayingArtist.textContent = track.artist + (track.isOnline ? ' · YouTube' : '');
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
        this.audio.volume = this.volume;
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
