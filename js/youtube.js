class YouTubeMusicAPI {
  constructor() {
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
    this.isInitialized = false;
  }

  // --- MENCARI SERVER INVIDIOUS YANG AKTIF (Untuk Pencarian) ---
  async fetchActiveInstances() {
    try {
      console.log("Mencari server pencarian aktif...");
      const res = await fetch('https://api.invidious.io/instances.json?sort_by=health');
      const data = await res.json();
      
      const validInstances = data
        .filter(item => item[1].type === 'https' && item[1].api === true && item[1].cors === true)
        .map(item => item[1].uri);

      if (validInstances.length > 0) {
        this.instances = validInstances;
      }
    } catch (err) {
      console.warn('Gagal mengambil server pencarian dinamis.');
    }
    this.isInitialized = true;
  }

  // --- FUNGSI TIMEOUT ---
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

  // --- FUNGSI REQUEST UTAMA ---
  async fetchJSON(endpoint) {
    if (!this.isInitialized) {
      await this.fetchActiveInstances();
    }

    const maxRetries = Math.min(this.instances.length, 5);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const currentInstance = this.instances[this.instanceIndex];

      try {
        const res = await this.fetchWithTimeout(`${currentInstance}${endpoint}`, {
          headers: { 'Accept': 'application/json' }
        }, 4000);
        if (res.ok) return await res.json();
      } catch (e) {}

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
        } catch (e) {}
      }
      this.instanceIndex = (this.instanceIndex + 1) % this.instances.length;
    }
    throw new Error('Server pencarian sedang sibuk/down.');
  }

  // --- MAPPING METADATA ---
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
    const data = await this.fetchJSON(`/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1&sort=relevance`);
    if (!Array.isArray(data)) return [];
    return data.filter(item => item.type === 'video' && item.videoId).slice(0, limit).map(v => this.mapVideo(v));
  }

  async getTrending() {
    const data = await this.fetchJSON('/api/v1/trending?type=music');
    if (!Array.isArray(data)) return [];
    return data.filter(v => v.videoId).slice(0, 24).map(v => this.mapVideo(v));
  }

  // =========================================================================
  // 🔥 SOLUSI HYBRID: GUNAKAN PIPED API KHUSUS UNTUK MEMUTAR AUDIO (Bypass CORS)
  // =========================================================================
  async getAudioStreamUrl(videoId) {
    try {
      // Daftar server Piped yang handal untuk proxy audio
      const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.tokhmi.xyz',
        'https://pipedapi.smnz.de'
      ];

      let streamData = null;

      // Coba tembak server Piped satu per satu
      for (const api of pipedInstances) {
        try {
          const res = await this.fetchWithTimeout(`${api}/streams/${videoId}`, {
            headers: { 'Accept': 'application/json' }
          }, 6000); // Beri waktu 6 detik karena dia harus membedah signature YouTube

          if (res.ok) {
            streamData = await res.json();
            if (streamData && streamData.audioStreams && streamData.audioStreams.length > 0) {
              break; // Berhasil dapat stream! Keluar dari loop.
            }
          }
        } catch (e) {
          console.warn(`[Piped] Gagal mengambil stream dari ${api}`);
        }
      }

      if (!streamData || !streamData.audioStreams || streamData.audioStreams.length === 0) {
        throw new Error('Tidak ada stream audio yang tersedia saat ini.');
      }

      // Urutkan kualitas dari yang paling tinggi (bitrate) ke terendah
      const audioFormats = streamData.audioStreams.sort((a, b) => b.bitrate - a.bitrate);

      // Cari format m4a/mp4 terlebih dahulu karena lebih stabil di semua browser (termasuk Safari)
      // Jika tidak ada, pakai format webm
      const bestAudio = audioFormats.find(f => f.mimeType.includes('mp4')) || audioFormats[0];

      return bestAudio.url;

    } catch (err) {
      console.error('Gagal mengambil jalur stream alternatif:', err);
      throw err;
    }
  }

  // --- DOWNLOAD AUDIO ---
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
