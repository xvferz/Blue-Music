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
  // 🔥 SOLUSI PAMUNGKAS: PENGAMBILAN AUDIO DENGAN PROXY INVIDIOUS
  // =========================================================================
  async getAudioStreamUrl(videoId) {
    console.log("Mencari jalur rahasia untuk audio...");
    
    // Daftar server "tahan banting" yang diketahui mengizinkan proxy audio
    const streamingServers = [
      this.instances[this.instanceIndex], // Prioritaskan server yang sedang aktif
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://inv.tux.pizza',
      'https://vid.puffyan.us'
    ];

    for (const server of streamingServers) {
      if (!server) continue;
      
      // KUNCI UTAMA: itag=140 (format M4A ringan) & local=true
      // local=true memaksa server ini menjadi "kurir" agar Google tidak memblokir IP-mu
      const proxyUrl = `${server}/latest_version?id=${videoId}&itag=140&local=true`;
      
      try {
        // TEKNIK PANCINGAN: 
        // Kita tidak langsung mendownload, tapi mengetuk pintu servernya 
        // dengan meminta 2 byte pertama lagu tersebut. Ini diproses dalam hitungan milidetik.
        const check = await this.fetchWithTimeout(proxyUrl, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-1' } 
        }, 3000);

        // Jika server membalas dengan OK (200) atau Partial (206), berarti jalurnya aman!
        if (check.ok || check.status === 206) {
          console.log(`Jalur audio berhasil ditemukan di: ${server}`);
          return proxyUrl; // Berikan URL ini ke mesin pemutar musik
        }
      } catch (e) {
        console.warn(`Jalur ${server} sedang macet, mencoba server berikutnya...`);
      }
    }

    // Jika kelima server di atas kebetulan down bersamaan
    throw new Error('Semua jalur streaming sedang dijaga ketat oleh YouTube. Coba lagu lain.');
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
