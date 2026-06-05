class YouTubeMusicAPI {
  constructor() {
    // Ini hanya server cadangan (fallback) jika sistem gagal mencari server baru
    this.instances = [
      'https://vid.puffyan.us',
      'https://inv.nadeko.net',
      'https://invidious.lunar.icu'
    ];

    this.proxies = [
      'https://api.allorigins.win/raw?url=',
      'https://corsproxy.io/?'
    ];

    this.instanceIndex = 0;
    this.isInitialized = false; // Penanda apakah kita sudah mencari server dinamis
  }

  // --- FITUR BARU: MENCARI SERVER YANG HIDUP HARI INI ---
  async fetchActiveInstances() {
    try {
      console.log("Mencari server Invidious yang sedang aktif...");
      // Tanya ke pusat data Invidious
      const res = await fetch('https://api.invidious.io/instances.json?sort_by=health');
      const data = await res.json();
      
      // Filter hanya server yang aman (https), API-nya nyala, dan mengizinkan lintas-domain (CORS)
      const validInstances = data
        .filter(item => item[1].type === 'https' && item[1].api === true && item[1].cors === true)
        .map(item => item[1].uri);

      if (validInstances.length > 0) {
        // Timpa server cadangan dengan server yang 100% fresh
        this.instances = validInstances;
        console.log(`Berhasil menemukan ${validInstances.length} server aktif!`);
      }
    } catch (err) {
      console.warn('Gagal mengambil server dinamis, menggunakan server cadangan.');
    }
    this.isInitialized = true;
  }

  // Fungsi Timeout
  async fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  }

  // Fungsi Pengambil Data Utama
  async fetchJSON(endpoint) {
    // Pastikan kita sudah punya daftar server fresh sebelum mulai mencari lagu
    if (!this.isInitialized) {
      await this.fetchActiveInstances();
    }

    const maxRetries = Math.min(this.instances.length, 5); // Maksimal coba 5 server berbeda

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const currentInstance = this.instances[this.instanceIndex];

      // 1. Coba jalur langsung
      try {
        const url = `${currentInstance}${endpoint}`;
        const res = await this.fetchWithTimeout(url, {
          headers: { 'Accept': 'application/json' }
        }, 4000);

        if (res.ok) return await res.json();
      } catch (e) {
        // Gagal jalur langsung, lanjut ke proxy
      }

      // 2. Coba pakai proxy jika jalur langsung diblokir (CORS)
      for (let p = 0; p < this.proxies.length; p++) {
        try {
          const proxyUrl = this.proxies[p];
          const targetUrl = `${currentInstance}${endpoint}`;
          const finalUrl = proxyUrl.includes('?') 
            ? `${proxyUrl}${encodeURIComponent(targetUrl)}` 
            : `${proxyUrl}${targetUrl}`;

          const res = await this.fetchWithTimeout(finalUrl, {
            headers: { 'Accept': 'application/json, text/plain, */*' }
          }, 5000);

          if (res.ok) {
            const text = await res.text();
            try { return JSON.parse(text); } catch (err) {}
          }
        } catch (e) {
          // Proxy gagal, lanjut proxy berikutnya
        }
      }

      // 3. Pindah ke server lain jika server ini dan proxynya gagal semua
      this.instanceIndex = (this.instanceIndex + 1) % this.instances.length;
    }

    throw new Error('Semua server sedang sibuk/down. Coba lagi nanti.');
  }

  // Mapping Data Video
  mapVideo(v) {
    const thumbs = v.videoThumbnails || [];
    thumbs.sort((a, b) => (b.width || 0) - (a.width || 0));

    return {
      id: `yt_${v.videoId}`,
      source: 'youtube',
      videoId: v.videoId,
      title: v.title || 'Unknown Title',
      artist: v.author || v.uploader || 'Unknown Artist',
      artistId: v.authorId || '',
      duration: v.lengthSeconds || 0,
      url: null,
      streamUrl: null,
      artwork: thumbs.length > 0 ? thumbs[0].url : null,
      viewCount: v.viewCount || 0,
      publishedText: v.publishedText || '',
      liked: false,
      dateAdded: Date.now(),
    };
  }

  // Fungsi Pencarian
  async search(query, limit = 30) {
    try {
      const data = await this.fetchJSON(
        `/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1&sort=relevance`
      );
      if (!Array.isArray(data)) return [];
      return data
        .filter(item => item.type === 'video' && item.videoId)
        .slice(0, limit)
        .map(v => this.mapVideo(v));
    } catch (err) {
      console.error('Search gagal:', err);
      throw err; 
    }
  }

  // Dapatkan Info Video
  async getVideoInfo(videoId) {
    try {
      return await this.fetchJSON(`/api/v1/videos/${videoId}`);
    } catch (err) {
      console.error('Video info gagal:', err);
      return null;
    }
  }

  // Dapatkan URL Audio Streaming
  async getAudioStreamUrl(videoId) {
    const data = await this.getVideoInfo(videoId);
    if (!data || !Array.isArray(data.adaptiveFormats)) {
      throw new Error('Tidak ada format audio');
    }

    const audioFormats = data.adaptiveFormats.filter(f =>
      f.mimeType && f.mimeType.startsWith('audio/')
    );

    if (audioFormats.length === 0) {
      throw new Error('Tidak ada format audio ditemukan');
    }

    audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return audioFormats[0].url;
  }

  // Dapatkan Daftar Trending
  async getTrending() {
    try {
      const data = await this.fetchJSON('/api/v1/trending?type=music');
      if (!Array.isArray(data)) return [];
      return data
        .filter(v => v.videoId)
        .slice(0, 24)
        .map(v => this.mapVideo(v));
    } catch (err) {
      console.error('Trending gagal:', err);
      throw err;
    }
  }

  // Download Audio
  async downloadAudio(videoId) {
    const streamUrl = await this.getAudioStreamUrl(videoId);

    try {
      const resp = await fetch(streamUrl);
      if (resp.ok) return await resp.blob();
    } catch (_) {}

    const proxyUrl = 'https://corsproxy.io/?';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(`${proxyUrl}${encodeURIComponent(streamUrl)}`);
        if (resp.ok) return await resp.blob();
      } catch (_) {}
    }

    throw new Error('Gagal mengunduh audio');
  }
}
