/**
 * YouTubeMusicAPI — pencarian & metadata via YouTube Data API (opsional) + instance Invidious publik.
 *
 * Prinsip kerja:
 *  - Kalau YT_DATA_API_KEY diisi (lihat KONFIGURASI di bawah), pencarian memakai
 *    YouTube Data API resmi — 100% andal dari browser, gratis ~100 pencarian/hari.
 *  - Tanpa key, dipakai instance Invidious publik dengan health probe + fallback
 *    berlapis. PENTING: sejak 2026 mayoritas instance publik diblokir untuk
 *    browser oleh sistem anti-bot (Anubis) sehingga jalur ini sering gagal —
 *    mengisi API key sangat disarankan.
 *  - Server yang terbukti bekerja diingat di localStorage.
 *  - Hasil pencarian di-cache 24 jam, sehingga saat jaringan server bermasalah
 *    pencarian yang pernah dilakukan tetap bisa ditampilkan.
 *  - Pemutaran audio TIDAK diurus di sini: class ini hanya memberi daftar
 *    URL stream (latest_version) untuk dicoba oleh PlaybackEngine.
 *    Kalau tidak ada yang bisa streaming, PlaybackEngine memakai embed YouTube.
 */

// ================== KONFIGURASI ==================
// Cara membuat key (5 menit, gratis):
//   1. Buka https://console.cloud.google.com
//   2. Buat project baru → pilih project tersebut
//   3. APIs & Services → Library → cari "YouTube Data API v3" → Enable
//   4. APIs & Services → Credentials → Create Credentials → API key
//   5. (Disarankan) Edit key → Application restrictions → Websites → tambahkan:
//      https://xvferz.github.io/*   dan   http://localhost:*/*
//   6. Tempel hasilnya di bawah, commit, push. Selesai.
const YT_DATA_API_KEY = '';

// Wilayah untuk daftar trending (ID = Indonesia, US = Amerika, dll.)
const YT_REGION_CODE = 'ID';
// =================================================

class YouTubeMusicAPI {
  constructor() {
    this.apiKey = (typeof YT_DATA_API_KEY === 'string' && YT_DATA_API_KEY.trim())
      ? YT_DATA_API_KEY.trim()
      : null;

    // Server bawaan. Server lain ditemukan dinamis saat runtime.
    this.builtinInstances = [
      'https://invidious.f5.si',
    ];

    this.instances = [...this.builtinInstances];
    this.searchInstance = null;   // instance yang terbukti bisa mencari (per sesi)
    this.streamInstance = null;   // instance yang terakhir berhasil streaming
    this.dynamicPromise = null;
    this.maxCandidates = 12;

    const saved = this.storeGet('bluesync_search_instance');
    if (saved) this.instances = this.dedupe([saved, ...this.instances]);
    const savedStream = this.storeGet('bluesync_stream_instance');
    if (savedStream) this.streamInstance = savedStream;
  }

  // ---------- Penyimpanan kecil yang aman ----------

  storeGet(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }

  storeSet(key, value) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, value);
    } catch (e) { /* storage penuh / private mode */ }
  }

  storeDel(key) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(key);
    } catch (e) { /* abaikan */ }
  }

  dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  // ---------- Kandidat server ----------

  async loadDynamicInstances() {
    if (this.dynamicPromise) return this.dynamicPromise;

    this.dynamicPromise = (async () => {
      try {
        const res = await this.fetchWithTimeout(
          'https://api.invidious.io/instances.json?sort_by=health',
          { headers: { Accept: 'application/json' } },
          6000
        );
        if (!res.ok) return;
        const data = await res.json();
        const found = data
          .filter(item => item[1] && item[1].type === 'https' && item[1].api === true && item[1].cors === true)
          .map(item => item[1].uri)
          .slice(0, this.maxCandidates);

        if (found.length) {
          this.instances = this.dedupe([...found, ...this.instances]).slice(0, this.maxCandidates + 4);
          console.log(`[YouTube] ${found.length} server dari daftar dinamis.`);
        }
      } catch (err) {
        console.warn('[YouTube] Gagal mengambil daftar server dinamis, memakai server bawaan.');
      }
    })();

    return this.dynamicPromise;
  }

  getSearchCandidates() {
    const remembered = this.storeGet('bluesync_search_instance');
    return this.dedupe([this.searchInstance, remembered, ...this.instances]).slice(0, this.maxCandidates + 4);
  }

  /**
   * URL stream untuk dicoba PlaybackEngine, urut dari yang paling mungkin bekerja.
   * @returns {Array<{instance: string, url: string}>}
   */
  getStreamUrls(videoId) {
    const bases = this.dedupe([this.streamInstance, this.searchInstance, ...this.instances]);
    return bases.map(base => ({
      instance: base,
      url: `${base}/latest_version?id=${encodeURIComponent(videoId)}&itag=140&local=true`,
    }));
  }

  rememberStreamInstance(base) {
    if (!base || this.streamInstance === base) return;
    this.streamInstance = base;
    this.storeSet('bluesync_stream_instance', base);
    this.instances = this.dedupe([base, ...this.instances]);
  }

  // ---------- Health probe ----------

  async probeSearch(base, timeoutMs = 8000) {
    try {
      const res = await this.fetchWithTimeout(
        `${base}/api/v1/search?q=music&type=video&page=1`,
        { headers: { Accept: 'application/json' } },
        timeoutMs
      );
      if (!res.ok) return false;
      const data = await res.json();
      return Array.isArray(data) && data.some(v => v && v.videoId);
    } catch (e) {
      return false;
    }
  }

  /**
   * Health check + balapan paralel semua kandidat.
   * Dipakai hanya kalau upaya langsung ke server utama gagal.
   */
  async getSearchInstance() {
    if (this.searchInstance) return this.searchInstance;

    await this.loadDynamicInstances();

    const candidates = this.getSearchCandidates();
    if (!candidates.length) throw new Error('Tidak ada kandidat server.');

    console.log(`[YouTube] Mencari server aktif dari ${candidates.length} kandidat…`);
    try {
      const winner = await Promise.any(candidates.map(base =>
        this.probeSearch(base).then(ok => {
          if (!ok) throw new Error(base);
          return base;
        })
      ));
      this.setSearchInstance(winner);
      return winner;
    } catch (e) {
      throw new Error('Semua server pencarian sedang offline.');
    }
  }

  setSearchInstance(base) {
    const changed = this.searchInstance !== base;
    this.searchInstance = base;
    this.storeSet('bluesync_search_instance', base);
    this.instances = this.dedupe([base, ...this.instances]);
    if (changed) console.log(`[YouTube] Server pencarian aktif: ${base}`);
  }

  invalidateSearchInstance() {
    this.searchInstance = null;
    this.storeDel('bluesync_search_instance');
  }

  getPreferredInstance() {
    return this.searchInstance
      || this.storeGet('bluesync_search_instance')
      || this.instances[0]
      || null;
  }

  async tryFetchJson(url, timeoutMs = 10000) {
    try {
      const res = await this.fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  /**
   * Satu percobaan pencarian ke satu server.
   * @returns {Array|null} array hasil (boleh kosong) atau null kalau server gagal.
   */
  async trySearch(base, query, timeoutMs = 10000) {
    try {
      const res = await this.fetchWithTimeout(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1&sort=relevance`,
        { headers: { Accept: 'application/json' } },
        timeoutMs
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Format respons tidak dikenal');

      return data
        .filter(v => v && v.type === 'video' && v.videoId)
        .slice(0, 30)
        .map(v => this.mapVideo(v));
    } catch (err) {
      console.warn(`[YouTube] Percobaan via ${base} gagal:`, err && err.message);
      return null;
    }
  }

  // ---------- Cache pencarian ----------

  queryKey(query) {
    return 'bluesync_q_' + encodeURIComponent(query.trim().toLowerCase()).slice(0, 120);
  }

  cacheSearch(query, tracks) {
    const key = this.queryKey(query);
    this.storeSet(key, JSON.stringify({ ts: Date.now(), tracks }));
    try {
      let index = JSON.parse(this.storeGet('bluesync_qindex') || '[]');
      if (!Array.isArray(index)) index = [];
      index = index.filter(k => k !== key);
      index.push(key);
      while (index.length > 40) {
        const old = index.shift();
        if (old) this.storeDel(old);
      }
      this.storeSet('bluesync_qindex', JSON.stringify(index));
    } catch (e) { /* abaikan */ }
  }

  getCachedSearch(query, allowStale = false) {
    try {
      const raw = this.storeGet(this.queryKey(query));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tracks) || !data.tracks.length) return null;
      if (!allowStale && Date.now() - data.ts > 24 * 60 * 60 * 1000) return null;
      return data.tracks;
    } catch (e) {
      return null;
    }
  }

  // ---------- YouTube Data API v3 (opsional, paling andal) ----------

  async dataApiSearch(query, limit = 30) {
    if (!this.apiKey) return null;
    try {
      const max = Math.min(limit, 50);
      const searchRes = await this.fetchWithTimeout(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=${max}&q=${encodeURIComponent(query)}&key=${this.apiKey}`,
        { headers: { Accept: 'application/json' } },
        10000
      );
      if (!searchRes.ok) {
        console.warn('[YouTube] Data API search HTTP', searchRes.status);
        return null;
      }
      const sj = await searchRes.json();
      const ids = (sj.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
      if (!ids.length) return [];

      // Detail (durasi + status embeddable) dalam satu panggilan.
      const vidRes = await this.fetchWithTimeout(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status,snippet&id=${ids.join(',')}&key=${this.apiKey}`,
        { headers: { Accept: 'application/json' } },
        10000
      );
      if (!vidRes.ok) return null;
      const vj = await vidRes.json();
      const byId = new Map((vj.items || []).map(v => [v.id, v]));

      return ids
        .map(id => byId.get(id))
        .filter(v => v && v.status && v.status.embeddable && v.contentDetails)
        .map(v => this.mapDataApiVideo(v));
    } catch (err) {
      console.warn('[YouTube] Data API gagal:', err && err.message);
      return null;
    }
  }

  async dataApiTrending(limit = 24) {
    if (!this.apiKey) return null;
    try {
      const res = await this.fetchWithTimeout(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status,snippet&chart=mostPopular&videoCategoryId=10&maxResults=${Math.min(limit, 50)}&regionCode=${encodeURIComponent(YT_REGION_CODE)}&key=${this.apiKey}`,
        { headers: { Accept: 'application/json' } },
        10000
      );
      if (!res.ok) return null;
      const data = await res.json();
      return (data.items || [])
        .filter(v => v.status && v.status.embeddable && v.contentDetails)
        .map(v => this.mapDataApiVideo(v));
    } catch (err) {
      return null;
    }
  }

  parseDuration(iso) {
    // "PT1H2M3S" -> detik
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
    if (!m) return 0;
    const d = Number(m[1] || 0);
    const h = Number(m[2] || 0);
    const min = Number(m[3] || 0);
    const s = Number(m[4] || 0);
    return d * 86400 + h * 3600 + min * 60 + s;
  }

  mapDataApiVideo(v) {
    const sn = v.snippet || {};
    const thumbs = sn.thumbnails || {};
    const artwork = (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {}).url || null;
    return {
      id: `yt_${v.id}`,
      source: 'youtube',
      videoId: v.id,
      title: sn.title || 'Unknown Title',
      artist: sn.channelTitle || 'Unknown Artist',
      artistId: sn.channelId || '',
      duration: v.contentDetails ? this.parseDuration(v.contentDetails.duration) : 0,
      url: null,
      streamUrl: null,
      artwork,
      viewCount: 0,
      publishedText: '',
      liked: false,
      dateAdded: Date.now(),
    };
  }

  // ---------- Pencarian & trending ----------

  async search(query, limit = 30) {
    const fresh = this.getCachedSearch(query);
    if (fresh) return fresh.slice(0, limit);

    // Upaya 0 (kalau key diisi): YouTube Data API resmi — jalur utama.
    if (this.apiKey) {
      const apiTracks = await this.dataApiSearch(query, limit);
      if (apiTracks) {
        if (apiTracks.length) this.cacheSearch(query, apiTracks);
        return apiTracks.slice(0, limit);
      }
      console.warn('[YouTube] Data API tidak tersedia, beralih ke instance publik…');
    }

    // Upaya 1: langsung ke server yang diingat — pencarian itu sendiri
    // sekaligus jadi health check, jadi tidak ada probe ganda.
    const direct = this.getPreferredInstance();
    if (direct) {
      const tracks = await this.trySearch(direct, query);
      if (tracks) {
        this.setSearchInstance(direct);
        if (tracks.length) this.cacheSearch(query, tracks);
        return tracks.slice(0, limit);
      }
      this.invalidateSearchInstance();
    }

    // Upaya 2: balapan health probe semua kandidat, lalu cari di pemenang.
    try {
      const inst = await this.getSearchInstance();
      const tracks = await this.trySearch(inst, query);
      if (tracks) {
        if (tracks.length) this.cacheSearch(query, tracks);
        return tracks.slice(0, limit);
      }
      this.invalidateSearchInstance();
    } catch (e) {
      console.warn('[YouTube]', e && e.message);
    }

    // Upaya 3: hasil cache lama (kalau ada).
    const stale = this.getCachedSearch(query, true);
    if (stale) {
      console.warn('[YouTube] Memakai cache lama untuk:', query);
      return stale.slice(0, limit);
    }

    throw new Error('Pencarian gagal: semua server sedang sibuk.');
  }

  async getTrending() {
    let cached = null;
    try {
      const raw = this.storeGet('bluesync_trending');
      if (raw) cached = JSON.parse(raw);
    } catch (e) { /* abaikan */ }

    if (cached && Array.isArray(cached.tracks) && cached.tracks.length &&
        Date.now() - cached.ts < 6 * 60 * 60 * 1000) {
      return cached.tracks;
    }

    // Upaya 0 (kalau key diisi): trending resmi YouTube.
    if (this.apiKey) {
      const apiTracks = await this.dataApiTrending(24);
      if (apiTracks && apiTracks.length) {
        this.storeSet('bluesync_trending', JSON.stringify({ ts: Date.now(), tracks: apiTracks }));
        return apiTracks;
      }
    }

    // Upaya 1: endpoint trending resmi instance.
    // Sanity filter: buang siaran langsung / video tanpa durasi —
    // sebagian instance tidak benar-benar memfilter kategori musik.
    const direct = this.getPreferredInstance();
    if (direct) {
      const data = await this.tryFetchJson(`${direct}/api/v1/trending?type=music`, 10000);
      if (Array.isArray(data)) {
        const tracks = data
          .filter(v => v && v.videoId && Number(v.lengthSeconds) > 60)
          .slice(0, 24)
          .map(v => this.mapVideo(v));
        if (tracks.length >= 6) {
          this.setSearchInstance(direct);
          this.storeSet('bluesync_trending', JSON.stringify({ ts: Date.now(), tracks }));
          return tracks;
        }
      }
    }

    // Upaya 2: trending diganti pencarian kurasi (server ini tidak punya
    // feed musik yang benar — lebih baik hasil musik sungguhan).
    try {
      const tracks = await this.search('top hits music', 24);
      if (tracks.length) {
        this.storeSet('bluesync_trending', JSON.stringify({ ts: Date.now(), tracks }));
        return tracks;
      }
    } catch (e) { /* lanjut ke cache lama */ }

    // Upaya 3: cache trending lama.
    if (cached && Array.isArray(cached.tracks) && cached.tracks.length) {
      return cached.tracks;
    }
    throw new Error('Trending tidak tersedia.');
  }

  // ---------- Utilitas ----------

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
      duration: Number(v.lengthSeconds) || 0,
      url: null,
      streamUrl: null,
      artwork: thumbs.length > 0 ? thumbs[0].url : null,
      viewCount: v.viewCount || 0,
      publishedText: v.publishedText || '',
      liked: false,
      dateAdded: Date.now(),
    };
  }
}
