/**
 * YouTubeMusicAPI — pencarian & metadata, tanpa server & tanpa key.
 *
 * Urutan penyedia (dicoba berurutan sampai salah satu berhasil):
 *  1. YouTube Data API v3 — kalau YT_DATA_API_KEY diisi (opsional, paling andal).
 *  2. Instance Piped publik — jalur utama tanpa key. Terbukti CORS-aman dan
 *     bisa dipanggil lintas origin dari browser (dites langsung di Chromium).
 *  3. Relay r.jina.ai → instance Invidious — cadangan saat Piped tumbang.
 *  4. Instance Invidious langsung — dipertahankan untuk lingkungan yang bisa
 *     mengaksesnya (banyak instance memasang tembok anti-bot untuk browser).
 *  5. Cache lama (24 jam) — supaya pencarian yang pernah dilakukan tetap jalan.
 *
 * Catatan:
 *  - Stream audio mentah (latest_version) umumnya diblokir untuk browser;
 *    pemutaran berjalan lewat embed YouTube (lihat player-engine.js).
 *  - Server yang terbukti bekerja diingat di localStorage.
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

    // Instance Piped — penyedia pencarian utama tanpa key (CORS-aman di browser).
    // Yang mati akan dilewati otomatis oleh health check saat pencarian pertama.
    this.pipedInstances = [
      'https://api.piped.private.coffee',
      'https://pipedapi.ducks.party',
      'https://pipedapi.adminforge.de',
      'https://pipedapi.orangenet.cc',
      'https://pipedapi.reallyaweso.me',
    ];
    this.pipedInstance = null;
    const savedPiped = this.storeGet('bluesync_piped_instance');
    if (savedPiped) this.pipedInstance = savedPiped;
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

      // Sekalian segarkan daftar Piped dari dokumentasi resminya (kalau bisa).
      try {
        const res = await this.fetchWithTimeout(
          'https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md',
          { headers: { Accept: 'text/plain' } },
          8000
        );
        if (res.ok) {
          const text = await res.text();
          const urls = [...text.matchAll(/https:\/\/[a-z0-9.-]+/gi)]
            .map(m => m[0].replace(/[.,;:)]+$/, ''))
            .filter(u => /^https:\/\/(api\.|pipedapi\.)/i.test(u));
          if (urls.length) {
            this.pipedInstances = this.dedupe([...urls, ...this.pipedInstances]).slice(0, 10);
          }
        }
      } catch (err) { /* pakai daftar bawaan */ }
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

  // ---------- Piped (jalur pencarian utama tanpa key) ----------

  getPipedCandidates() {
    const remembered = this.storeGet('bluesync_piped_instance');
    return this.dedupe([this.pipedInstance, remembered, ...this.pipedInstances]).slice(0, 8);
  }

  async tryPipedSearch(base, query, timeoutMs = 9000) {
    try {
      const res = await this.fetchWithTimeout(
        `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs`,
        { headers: { Accept: 'application/json' } },
        timeoutMs
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) throw new Error('Format respons tidak dikenal');
      return data.items
        .filter(item => item && typeof item.url === 'string' && item.url.includes('v='))
        .map(item => this.mapPipedItem(item));
    } catch (err) {
      console.warn(`[YouTube] Piped ${base} gagal:`, err && err.message);
      return null;
    }
  }

  async pipedSearch(query, limit = 30) {
    const candidates = this.getPipedCandidates();
    if (!candidates.length) return null;

    // Coba server yang diingat dulu — pencarian ini sekaligus health check.
    const direct = await this.tryPipedSearch(candidates[0], query);
    if (direct) {
      this.setPipedInstance(candidates[0]);
      return direct.slice(0, limit);
    }
    this.pipedInstance = null;
    this.storeDel('bluesync_piped_instance');

    // Balapan kandidat lainnya; yang pertama berhasil menang.
    const rest = candidates.slice(1);
    if (!rest.length) return null;
    console.log(`[YouTube] Mencari server Piped aktif dari ${rest.length} kandidat…`);
    try {
      const winner = await Promise.any(rest.map(base =>
        this.tryPipedSearch(base, query).then(tracks => {
          if (!tracks || !tracks.length) throw new Error('kosong');
          return { base, tracks };
        })
      ));
      this.setPipedInstance(winner.base);
      return winner.tracks.slice(0, limit);
    } catch (e) {
      return null;
    }
  }

  setPipedInstance(base) {
    const changed = this.pipedInstance !== base;
    this.pipedInstance = base;
    this.storeSet('bluesync_piped_instance', base);
    if (changed) console.log(`[YouTube] Server Piped aktif: ${base}`);
  }

  mapPipedItem(item) {
    const videoId = (String(item.url).split('v=')[1] || '').split('&')[0];
    return {
      id: `yt_${videoId}`,
      source: 'youtube',
      videoId,
      title: item.title || 'Unknown Title',
      artist: item.uploaderName || 'Unknown Artist',
      artistId: item.uploaderUrl || '',
      duration: Number(item.duration) || 0,
      url: null,
      streamUrl: null,
      artwork: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
      viewCount: item.views || 0,
      publishedText: item.uploadedDate || '',
      liked: false,
      dateAdded: Date.now(),
    };
  }

  // ---------- Relay r.jina.ai (cadangan lintas origin) ----------

  async jinaSearch(query, limit = 30) {
    try {
      const base = this.getPreferredInstance() || 'https://invidious.f5.si';
      const target = `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1&sort=relevance`;
      const res = await this.fetchWithTimeout(
        `https://r.jina.ai/${target}`,
        { headers: { Accept: 'text/plain' } },
        20000
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const start = text.indexOf('[');
      if (start < 0) throw new Error('Bukan JSON');
      const data = JSON.parse(text.slice(start));
      if (!Array.isArray(data)) throw new Error('Format tidak dikenal');
      return data
        .filter(v => v && v.videoId)
        .slice(0, 30)
        .map(v => this.mapVideo(v))
        .slice(0, limit);
    } catch (err) {
      console.warn('[YouTube] Relay jina gagal:', err && err.message);
      return null;
    }
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

    // Upaya 1: Piped — jalur utama tanpa key, terbukti CORS-aman di browser.
    this.loadDynamicInstances(); // segarkan kandidat di latar (tidak ditunggu)
    const pipedTracks = await this.pipedSearch(query, limit);
    if (pipedTracks) {
      if (pipedTracks.length) this.cacheSearch(query, pipedTracks);
      return pipedTracks.slice(0, limit);
    }

    // Upaya 2: relay r.jina.ai → Invidious (cadangan lintas origin).
    const relayed = await this.jinaSearch(query, limit);
    if (relayed) {
      if (relayed.length) this.cacheSearch(query, relayed);
      return relayed.slice(0, limit);
    }

    // Upaya 3: langsung ke instance Invidious yang diingat — pencarian itu
    // sendiri sekaligus health check, jadi tidak ada probe ganda.
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

    // Upaya 4: balapan health probe semua kandidat Invidious, lalu cari di pemenang.
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

    // Upaya 5: hasil cache lama (kalau ada).
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

    // Upaya 1: pencarian kurasi lewat jalur Piped/relay. Feed "trending"
    // milik instance publik isinya sering bukan musik, jadi tidak dipakai.
    try {
      const tracks = await this.search('top hits music', 24);
      if (tracks.length) {
        this.storeSet('bluesync_trending', JSON.stringify({ ts: Date.now(), tracks }));
        return tracks;
      }
    } catch (e) { /* lanjut ke cache lama */ }

    // Upaya 2: cache trending lama.
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
