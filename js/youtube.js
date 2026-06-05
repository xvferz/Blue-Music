class YouTubeMusicAPI {
  constructor() {
    this.instances = [
      'https://iv.ggtyler.dev',
      'https://invidious.nerdvpn.de',
      'https://inv.tux.pizza',
      'https://invidious.privacydev.net',
      'https://invidious.fdn.fr'
    ];

    this.proxies = [
      'https://api.allorigins.win/raw?url=',
      'https://corsproxy.io/?'
    ];

    this.instanceIndex = 0;
    this.proxyIndex = -1;
    this.useProxy = false;
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
    const maxRetries = this.instances.length;

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
        console.warn(`[Direct] Gagal atau lambat di ${currentInstance}`);
      }

      // 2. Coba pakai proxy jika jalur langsung diblokir
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
            try { 
              return JSON.parse(text); 
            } catch (err) {}
          }
        } catch (e) {
          console.warn(`[Proxy] Gagal menggunakan proxy ${this.proxies[p]}`);
        }
      }

      // 3. Pindah ke server lain
      this.instanceIndex = (this.instanceIndex + 1) % this.instances.length;
    }

    throw new Error('Semua server sedang down. Coba lagi nanti.');
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
      // Lempar error ke app.js agar UI menampilkan pesan gagal
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