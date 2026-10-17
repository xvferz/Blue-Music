/**
 * LyricsEngine — lirik tersinkron untuk BlueSync.
 *
 * Sumber utama : Better Lyrics API (TTML dengan penanda waktu per kata).
 *   API ini tidak mengirim header CORS dan hanya melayani lagu yang sudah
 *   ada di cache publiknya tanpa API key, jadi permintaan dilewatkan relay
 *   teks yang sudah dipakai BlueSync (r.jina.ai dkk.). Sebelum memanggil,
 *   metadata kanonik (album + durasi) diambil dari iTunes — kunci cache
 *   API-nya menyertakan keduanya, jadi ini menaikkan peluang hit.
 * Sumber kedua  : LRC.RED — basis data lirik yang dipakai Better Lyrics
 *   sendiri (CORS terbuka). TTML/LRC-nya diunduh per ISRC.
 * Sumber ketiga : LRCLIB (lrclib.net) — CORS terbuka, tanpa API key.
 *
 * Hasil terbaik disimpan di localStorage supaya lagu yang sama tidak
 * diambil berulang kali.
 */
class LyricsEngine {
  constructor(opts = {}) {
    this.relay = typeof opts.relay === 'function' ? opts.relay : null;
    this.mem = new Map();
    this.storageKey = 'bluesync_lyrics_cache_v1';
    this.maxEntries = 40;
    this._loadedCache = false;
  }

  /* ================= API utama ================= */

  /**
   * Ambil lirik untuk sebuah track (objek dari this.tracks).
   * onDoc dipanggil setiap kali ada hasil — termasuk saat hasil Better
   * Lyrics yang lebih baik menyusul di belakang.
   * @returns {Promise<object|null>} dokumen lirik terbaik
   */
  async load(track, onDoc, opts = {}) {
    const meta = this.buildMeta(track);
    if (!meta || !meta.title) return null;

    if (!opts.force) {
      this.loadCache();
      const cached = this.mem.get(meta.key);
      if (cached) {
        if (onDoc) onDoc(cached);
        return cached;
      }
    }

    let best = null;
    let firstSaved = false;
    const deliver = (doc) => {
      if (!doc) return;
      if (!best || this.rank(doc) > this.rank(best)) {
        best = doc;
        if (onDoc) onDoc(doc);
        // Simpan hasil pertama segera supaya kunjungan berikutnya instan,
        // walau hasil Better Lyrics (upgrade) belum selesai.
        if (!firstSaved) {
          firstSaved = true;
          this.saveDoc(meta.key, doc);
        }
      }
    };

    await Promise.allSettled([
      this.fromBetterLyrics(meta).then(deliver).catch(() => {}),
      this.fromLrcRed(meta).then(deliver).catch(() => {}),
      this.fromLrclib(meta).then(deliver).catch(() => {}),
    ]);

    if (best) {
      this.saveDoc(meta.key, best);
      return best;
    }
    return null;
  }

  /**
   * Prioritas: Better Lyrics (API resmi) > LRC.RED (basis data yang dipakai
   * Better Lyrics sendiri) > LRCLIB. Di dalam satu sumber: karaoke per kata
   * > tersinkron per baris > tanpa penanda waktu.
   */
  rank(doc) {
    if (!doc) return -1;
    if (doc.instrumental) return 6;
    const sync = doc.sync === 'word' ? 3 : doc.sync === 'line' ? 2 : 1;
    const prov = doc.provider === 'better' ? 40 : doc.provider === 'lrcred' ? 30 : 20;
    return prov + sync;
  }

  /* ================= Metadata & pembersihan judul ================= */

  buildMeta(track) {
    const rawTitle = String((track && track.title) || '').trim();
    const rawArtist = String((track && track.artist) || '').trim();
    if (!rawTitle) return null;

    const artist = this.cleanArtist(rawArtist);
    const title = this.cleanTitle(rawTitle, artist);
    const duration = Math.round(Number(track && track.duration) || 0);
    const bucket = duration > 0 ? Math.round(duration / 5) * 5 : 0;

    return {
      title,
      artist,
      duration,
      videoId: (track && track.videoId) || null,
      rawTitle,
      key: `${title.toLowerCase()}|${artist.toLowerCase()}|${bucket}`,
    };
  }

  /** Buang embel-embel video di judul YouTube: (Official Video), [HD], dll. */
  cleanTitle(title, artist) {
    const REMOVE = /(official|lyrics?|audio|visuali[sz]er|music\s*video|video\s*clip|\bmv\b|m\/v|\bhd\b|\bhq\b|4k\b|8k\b|remaster(ed)?|explicit|full\s*(song|video)|clip\s*officiel|vídeo\s*oficial)/i;
    let t = String(title);

    t = t.replace(/\s*[(\[{][^)\]}]*[)\]}]/g, (m) => (REMOVE.test(m) ? '' : m));
    // "| Official Video" di bagian ekor judul.
    t = t.replace(/\s*[|·]\s*[^|·]*\b(official|lyric|audio|video)\b[^|·]*$/i, '');
    t = t.replace(/\s*[-–—]\s*(official\s*)?(music\s*)?(video|audio|lyric[s]?|visuali[sz]er)\s*$/i, '');

    // "Queen - Bohemian Rhapsody" → "Bohemian Rhapsody" bila diawali nama artis.
    const a = String(artist || '').toLowerCase().trim();
    if (a && t.toLowerCase().startsWith(a)) {
      const rest = t.slice(artist.length).replace(/^\s*[-–—:|·]+\s*/, '');
      if (rest.length >= 2) t = rest;
    }

    t = t.replace(/\s{2,}/g, ' ').trim();
    return t || String(title).trim();
  }

  /** "Nadin Amizah - Topic", "QueenVEVO", "Queen Official" → nama bersih. */
  cleanArtist(artist) {
    const a = String(artist || '').trim();
    if (!a) return '';
    const cleaned = a
      .replace(/\s*-\s*topic$/i, '')
      .replace(/\s*\bvevo\b\s*$/i, '')
      .replace(/\s*\bofficial\b(\s+(music|channel|artist))?\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || a;
  }

  /* ================= Sumber 1: Better Lyrics ================= */

  /**
   * Better Lyrics: makin lengkap metadatanya (s + a + al + d), makin besar
   * peluang cache hit — kunci cache-nya menyertakan album & durasi.
   * Karena itu metadata kanonik diambil dulu dari iTunes (gratis, CORS
   * terbuka), lalu API dipanggil lewat relay teks.
   */
  async fromBetterLyrics(meta) {
    if (!this.relay) return null;

    const catalog = await this.itunesLookup(meta).catch(() => null);

    // Variasi dari yang paling spesifik ke paling umum.
    const variants = [];
    if (catalog && catalog.title) {
      variants.push({
        s: catalog.title,
        a: catalog.artist || meta.artist,
        al: catalog.album || '',
        d: catalog.duration || 0,
        videoId: meta.videoId,
      });
    }
    variants.push({ s: meta.title, a: meta.artist, al: '', d: meta.duration || 0, videoId: meta.videoId });
    variants.push({ s: meta.title, a: meta.artist, al: '', d: 0, videoId: meta.videoId });

    // Buang duplikat.
    const seen = new Set();
    const unique = variants.filter((v) => {
      const key = `${v.s}|${v.a}|${v.al}|${v.d ? Math.round(v.d) : 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const hosts = ['https://api.betterlyrics.org', 'https://lyrics-api.boidu.dev'];
    for (const host of hosts) {
      let backendAnswered = false;
      for (const v of unique) {
        const params = new URLSearchParams();
        if (v.s) params.set('s', v.s);
        if (v.a) params.set('a', v.a);
        if (v.al) params.set('al', v.al);
        if (v.d > 0) params.set('d', String(Math.round(v.d)));
        if (v.videoId) params.set('videoId', v.videoId);

        const json = await this.relayWithTimeout(`${host}/getLyrics?${params.toString()}`, 14000);
        if (!json) continue; // relay gagal — coba variasi berikutnya
        // Amplop galat relay (mis. rate limit jina) bukan jawaban backend.
        const answered = json.ttml !== undefined || json.error !== undefined;
        if (!answered) continue;
        backendAnswered = true;

        if (json.ttml) {
          const parsed = this.parseTtml(json.ttml);
          if (parsed && parsed.lines.length) {
            return {
              provider: 'better',
              sync: parsed.sync,
              lines: parsed.lines,
              title: v.s || meta.title,
              artist: v.a || meta.artist,
              ts: Date.now(),
            };
          }
        }
        // json.error (401 cache miss / 404) — variasi lain masih bisa HIT.
      }
      if (backendAnswered) return null; // host ini jalan; host lain backend-nya sama
    }
    return null;
  }

  /** Cari metadata kanonik (judul, artis, album, durasi) di iTunes. */
  async itunesLookup(meta) {
    const term = `${meta.artist} ${meta.title}`.trim();
    if (!term) return null;

    const j = await this.fetchJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=8`,
      8000
    );
    if (!j || !Array.isArray(j.results) || !j.results.length) return null;

    const title = String(meta.title || '').toLowerCase();
    const artist = String(meta.artist || '').toLowerCase();
    let best = null;
    let bestScore = -1;

    for (const it of j.results) {
      if (!it || !it.trackName) continue;
      let score = 0;
      const t = String(it.trackName).toLowerCase();
      const a = String(it.artistName || '').toLowerCase();

      if (t === title) score += 4;
      else if (t.includes(title) || title.includes(t)) score += 2;

      if (artist) {
        if (a.includes(artist) || artist.includes(a)) score += 4;
        else {
          const words = artist.split(/\s+/).filter((w) => w.length > 2);
          if (words.some((w) => a.includes(w))) score += 1;
        }
      }

      if (meta.duration > 0 && it.trackTimeMillis) {
        const diff = Math.abs(it.trackTimeMillis / 1000 - meta.duration);
        if (diff <= 8) score += 3;
        else if (diff <= 20) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }

    if (!best || bestScore < 5) return null;
    return {
      title: best.trackName,
      artist: best.artistName || meta.artist,
      album: best.collectionName || '',
      duration: best.trackTimeMillis ? Math.round(best.trackTimeMillis / 1000) : 0,
    };
  }

  relayWithTimeout(url, timeoutMs = 18000) {
    if (!this.relay) return Promise.resolve(null);
    return Promise.race([
      this.relay(url).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  /* ================= Sumber 2: LRC.RED (basis data Better Lyrics) ====== */

  /**
   * LRC.RED adalah basis data lirik yang dipakai Better Lyrics sendiri
   * (29+ juta lagu, sebagian berpenanda waktu per kata). Pencarian lewat
   * /search.json, lalu berkas liriknya diunduh dari /s/<isrc>.ttml.
   */
  async fromLrcRed(meta) {
    const queries = [];
    const full = `${meta.artist} ${meta.title}`.trim();
    if (full) queries.push(full);
    if (meta.title && meta.title !== full) queries.push(meta.title);

    for (const q of queries) {
      const j = await this.fetchJson(`https://lrc.red/search.json?q=${encodeURIComponent(q)}`, 6500);
      const hits = j && Array.isArray(j.hits) ? j.hits.filter((h) => h && h.isrc) : [];
      if (!hits.length) continue;

      const hit = this.pickLrcRedHit(hits, meta);
      if (!hit) continue;

      const id = hit.isrc;
      const ttml = await this.fetchText(`https://lrc.red/s/${id}.ttml`, 6500);
      if (ttml) {
        const parsed = this.parseTtml(ttml);
        if (parsed && parsed.lines.length) {
          return {
            provider: 'lrcred',
            sync: parsed.sync,
            lines: parsed.lines,
            title: meta.title,
            artist: meta.artist,
            ts: Date.now(),
          };
        }
      }

      const lrc = await this.fetchText(`https://lrc.red/s/${id}.lrc`, 6500);
      if (lrc) {
        const lines = this.parseLrc(lrc);
        if (lines) {
          return {
            provider: 'lrcred',
            sync: 'line',
            lines,
            title: meta.title,
            artist: meta.artist,
            ts: Date.now(),
          };
        }
      }
    }
    return null;
  }

  pickLrcRedHit(hits, meta) {
    const title = String(meta.title || '').toLowerCase();
    const artist = String(meta.artist || '').toLowerCase();
    let best = null;
    let bestScore = -1;

    for (const h of hits) {
      let score = 0;
      const ht = String(h.title || h.name || h.trackName || '').toLowerCase();
      const ha = String(h.artist || h.artistName || (Array.isArray(h.artists) ? h.artists.join(' ') : '') || '').toLowerCase();

      if (ht && title) {
        if (ht === title) score += 4;
        else if (ht.includes(title) || title.includes(ht)) score += 2;
      } else {
        score += 1; // bidang tidak tersedia — netral
      }
      if (ha && artist) {
        if (ha.includes(artist) || artist.includes(ha)) score += 4;
      } else {
        score += 1;
      }
      if (typeof h.duration === 'number' && meta.duration > 0) {
        const diff = Math.abs(h.duration - meta.duration);
        if (diff <= 6) score += 3;
        else if (diff <= 15) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  /* ================= Sumber 3: LRCLIB ================= */

  async fromLrclib(meta) {
    const api = 'https://lrclib.net/api';
    const tries = [];

    if (meta.artist) {
      const p1 = new URLSearchParams({ artist_name: meta.artist, track_name: meta.title });
      if (meta.duration > 0) p1.set('duration', String(meta.duration));
      tries.push({ url: `${api}/get?${p1.toString()}`, kind: 'get' });

      const p2 = new URLSearchParams({ artist_name: meta.artist, track_name: meta.title });
      tries.push({ url: `${api}/get?${p2.toString()}`, kind: 'get' });

      const p3 = new URLSearchParams({ artist_name: meta.artist, track_name: meta.title });
      tries.push({ url: `${api}/search?${p3.toString()}`, kind: 'search' });
    }

    tries.push({ url: `${api}/search?${new URLSearchParams({ q: `${meta.artist} ${meta.title}`.trim() }).toString()}`, kind: 'search' });

    if (meta.rawTitle && meta.rawTitle.toLowerCase() !== meta.title.toLowerCase()) {
      tries.push({ url: `${api}/search?${new URLSearchParams({ q: meta.rawTitle }).toString()}`, kind: 'search' });
    }

    for (const t of tries) {
      const doc = t.kind === 'get' ? await this.tryLrclibGet(t.url, meta) : await this.lrclibSearch(t.url, meta);
      if (doc) return doc;
    }
    return null;
  }

  async tryLrclibGet(url, meta) {
    const j = await this.fetchJson(url);
    if (!j || !j.id) return null; // 404 → { statusCode, message }
    return this.docFromLrclib(j, meta);
  }

  async lrclibSearch(url, meta) {
    const arr = await this.fetchJson(url);
    if (!Array.isArray(arr) || !arr.length) return null;
    const best = this.pickLrclib(arr, meta);
    return best ? this.docFromLrclib(best, meta) : null;
  }

  pickLrclib(arr, meta) {
    const artist = String(meta.artist || '').toLowerCase();
    const title = String(meta.title || '').toLowerCase();
    let best = null;
    let bestScore = -1;

    for (const it of arr) {
      if (!it || !it.trackName) continue;
      let score = 0;
      if (it.syncedLyrics) score += 4;
      else if (it.plainLyrics) score += 1;
      else continue;

      const itTitle = String(it.trackName).toLowerCase();
      const itArtist = String(it.artistName || '').toLowerCase();
      if (itTitle === title || itTitle.includes(title) || title.includes(itTitle)) score += 3;
      if (artist && (itArtist.includes(artist) || artist.includes(itArtist))) score += 3;
      if (meta.duration > 0 && it.duration) {
        const diff = Math.abs(it.duration - meta.duration);
        if (diff <= 5) score += 3;
        else if (diff <= 12) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  docFromLrclib(j, meta) {
    if (!j) return null;
    if (j.instrumental) {
      return {
        provider: 'lrclib', sync: 'none', instrumental: true, lines: [],
        title: meta.title, artist: meta.artist, ts: Date.now(),
      };
    }
    if (j.syncedLyrics) {
      const lines = this.parseLrc(j.syncedLyrics);
      if (lines) {
        return {
          provider: 'lrclib', sync: 'line', lines,
          title: j.trackName || meta.title, artist: j.artistName || meta.artist, ts: Date.now(),
        };
      }
    }
    if (j.plainLyrics) {
      return {
        provider: 'lrclib', sync: 'none', plain: j.plainLyrics,
        title: j.trackName || meta.title, artist: j.artistName || meta.artist, ts: Date.now(),
      };
    }
    return null;
  }

  async fetchJson(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Unduh teks (TTML/LRC) dari lrc.red; tolak halaman HTML galat. */
  async fetchText(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || /^\s*<(!doctype|html)/i.test(text)) return null;
      return text;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ================= Offset sinkronisasi per lagu ================= */

  offsetKey(track) {
    const meta = this.buildMeta(track);
    return meta ? meta.key : null;
  }

  getOffset(key) {
    if (!key) return 0;
    try {
      const map = JSON.parse(localStorage.getItem('bluesync_lyrics_offsets') || '{}');
      return Number(map[key]) || 0;
    } catch (e) {
      return 0;
    }
  }

  setOffset(key, value) {
    if (!key) return;
    const v = Math.max(-10, Math.min(10, Math.round(value * 10) / 10));
    try {
      const map = JSON.parse(localStorage.getItem('bluesync_lyrics_offsets') || '{}');
      if (v === 0) delete map[key];
      else map[key] = v;
      const keys = Object.keys(map);
      if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete map[k];
      localStorage.setItem('bluesync_lyrics_offsets', JSON.stringify(map));
    } catch (e) {
      /* penyimpanan penuh — abaikan */
    }
  }

  /* ================= Parser ================= */

  /** "5:23.508" / "0.000" / "1:02:03.4" → detik. */
  parseTime(value) {
    if (value == null || value === '') return null;
    const parts = String(value).split(':');
    let total = 0;
    for (const p of parts) total = total * 60 + parseFloat(p || '0');
    return isNaN(total) ? null : total;
  }

  /**
   * TTML Better Lyrics → { lines, sync }.
   * Setiap <p> = satu baris; setiap <span> = satu kata/suku kata
   * dengan penanda waktu sendiri (mode karaoke).
   */
  parseTtml(ttml) {
    let xml;
    try {
      xml = new DOMParser().parseFromString(ttml, 'application/xml');
      if (!xml || xml.querySelector('parsererror')) return null;
    } catch (e) {
      return null;
    }

    const ps = Array.from(xml.querySelectorAll('body p'));
    const lines = [];
    let wordSync = false;

    for (const p of ps) {
      const t = this.parseTime(p.getAttribute('begin'));
      if (t == null) continue;
      const e = this.parseTime(p.getAttribute('end'));

      const words = [];
      let prefix = '';
      for (const node of Array.from(p.childNodes)) {
        if (node.nodeType === 3) {
          // Teks spasi antar kata — tempelkan ke kata sebelumnya.
          if (words.length) words[words.length - 1].text += node.data || '';
          else prefix += node.data || '';
        } else if (node.nodeType === 1 && node.localName === 'span') {
          const word = { text: node.textContent || '', t: null, e: null };
          const wt = this.parseTime(node.getAttribute('begin'));
          const we = this.parseTime(node.getAttribute('end'));
          if (wt != null) { word.t = wt; wordSync = true; }
          if (we != null) word.e = we;
          words.push(word);
        }
      }

      if (prefix && words.length) words[0].text = prefix + words[0].text;
      const rawText = words.length ? words.map((w) => w.text).join('') : prefix;
      const text = rawText.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      lines.push({ t, e, text, words: words.length ? words : null });
    }

    if (!lines.length) return null;
    return { lines: this.fillEndTimes(lines), sync: wordSync ? 'word' : 'line' };
  }

  /** LRC "[mm:ss.xx]teks" (bisa beberapa stempel waktu per baris) → lines. */
  parseLrc(text) {
    const lines = [];
    const stamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

    for (const raw of String(text).split(/\r?\n/)) {
      stamp.lastIndex = 0;
      const times = [];
      let m;
      while ((m = stamp.exec(raw))) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const frac = m[3] ? parseFloat(`0.${m[3]}`) : 0;
        times.push(min * 60 + sec + frac);
      }
      if (!times.length) continue;
      const txt = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (!txt) continue;
      for (const t of times) lines.push({ t, e: null, text: txt, words: null });
    }

    if (!lines.length) return null;
    lines.sort((a, b) => a.t - b.t);
    return this.fillEndTimes(lines);
  }

  fillEndTimes(lines) {
    lines.sort((a, b) => a.t - b.t);
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i + 1];
      if (lines[i].e == null || (next && next.t < lines[i].e)) {
        lines[i].e = next ? next.t : (lines[i].e != null ? lines[i].e : lines[i].t + 6);
      }
    }
    return lines;
  }

  /* ================= Cache ================= */

  loadCache() {
    if (this._loadedCache) return;
    this._loadedCache = true;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return;
      entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      for (const entry of entries.slice(0, this.maxEntries)) {
        if (entry && entry.key && entry.doc) this.mem.set(entry.key, entry.doc);
      }
    } catch (e) {
      /* cache rusak — abaikan */
    }
  }

  saveDoc(key, doc) {
    this.mem.set(key, doc);
    try {
      const entries = [];
      for (const [k, d] of this.mem) entries.push({ key: k, ts: d.ts || 0, doc: d });
      entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));

      const trimmed = entries.slice(0, this.maxEntries).map((entry) => {
        let d = entry.doc;
        // Dokumen karaoke bisa sangat besar — simpan versi ringkasnya.
        if (Array.isArray(d.lines) && JSON.stringify(d).length > 45000) {
          d = {
            ...d,
            sync: d.sync === 'word' ? 'line' : d.sync,
            lines: d.lines.map((l) => ({ t: l.t, e: l.e, text: l.text, words: null })),
          };
        }
        return { key: entry.key, ts: entry.ts || Date.now(), doc: d };
      });
      localStorage.setItem(this.storageKey, JSON.stringify(trimmed));
    } catch (e) {
      try { localStorage.removeItem(this.storageKey); } catch (e2) { /* penuh */ }
    }
  }
}
