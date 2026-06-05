class YouTubeMusicAPI {
  constructor() {
    this.instances = [
      'https://inv.nadeko.net',
      'https://invidious.snopyta.org',
      'https://yewtu.be',
      'https://inv.riverside.rocks',
      'https://invidious.private.coffee',
      'https://invidious.xyz',
    ];

    this.proxies = [
      'https://corsproxy.io/?',
      'https://api.allorigins.win/raw?url=',
      'https://proxy.cors.sh/',
    ];

    this.instanceIndex = 0;
    this.proxyIndex = -1;
    this.useProxy = false;
  }

  get baseUrl() {
    return this.instances[this.instanceIndex];
  }

  buildUrl(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    if (!this.useProxy || this.proxyIndex < 0) return url;
    const proxy = this.proxies[this.proxyIndex];

    if (proxy.includes('corsproxy.io')) {
      return `${proxy}${encodeURIComponent(url)}`;
    }
    if (proxy.includes('allorigins')) {
      return `${proxy}${encodeURIComponent(url)}`;
    }
    return `${proxy}${url}`;
  }

  async fetchJSON(endpoint) {
    // Try direct first (in case instance has CORS)
    if (!this.useProxy) {
      try {
        const url = `${this.baseUrl}${endpoint}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.ok) return await res.json();
      } catch (_) {}
    }

    // Try each proxy
    for (let p = 0; p < this.proxies.length; p++) {
      this.proxyIndex = p;
      this.useProxy = true;
      const proxyUrl = this.proxies[p];
      const targetUrl = `${this.baseUrl}${endpoint}`;
      let finalUrl;

      if (proxyUrl.includes('corsproxy.io') || proxyUrl.includes('allorigins')) {
        finalUrl = `${proxyUrl}${encodeURIComponent(targetUrl)}`;
      } else {
        finalUrl = `${proxyUrl}${targetUrl}`;
      }

      try {
        const res = await fetch(finalUrl, {
          headers: { 'Accept': 'application/json, text/plain, */*' },
        });
        if (res.ok) {
          const text = await res.text();
          try { return JSON.parse(text); } catch (_) {}
        }
      } catch (_) {}
    }

    // Try next instance
    this.useProxy = false;
    this.proxyIndex = -1;
    this.instanceIndex = (this.instanceIndex + 1) % this.instances.length;
    if (this.instanceIndex !== 0) return this.fetchJSON(endpoint);

    throw new Error('Gagal terhubung ke server YouTube. Periksa koneksi internet.');
  }

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
      return [];
    }
  }

  async getVideoInfo(videoId) {
    try {
      return await this.fetchJSON(`/api/v1/videos/${videoId}`);
    } catch (err) {
      console.error('Video info gagal:', err);
      return null;
    }
  }

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
      return [];
    }
  }

  async downloadAudio(videoId) {
    const streamUrl = await this.getAudioStreamUrl(videoId);

    // Try direct fetch
    try {
      const resp = await fetch(streamUrl);
      if (resp.ok) return await resp.blob();
    } catch (_) {}

    // Try through CORS proxy
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
