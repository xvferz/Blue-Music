/**
 * LyricsEngine — lirik tersinkron untuk BlueSync.
 *
 * Sumber utama : Better Lyrics API (TTML dengan penanda waktu per kata).
 *   API ini tidak mengirim header CORS dan hanya melayani lagu yang sudah
 *   ada di cache publiknya tanpa API key, jadi permintaan dilewatkan relay
 *   teks yang sudah dipakai BlueSync (r.jina.ai dkk.). Bila berhasil,
 *   tampilan lirik "diupgrade" ke mode karaoke per kata di latar belakang.
 * Sumber cadangan: LRCLIB (lrclib.net) — CORS terbuka, tanpa API key,
 *   menyediakan LRC tersinkron.
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
      this.fromLrclib(meta).then(deliver).catch(() => {}),
    ]);

    if (best) {
      this.saveDoc(meta.key, best);
      return best;
    }
    return null;
  }

  /** Semakin tinggi semakin baik: karaoke per kata > tersinkron > biasa. */
  rank(doc) {
    if (!doc) return -1;
    if (doc.instrumental) return 5;
    const base = doc.sync === 'word' ? 3 : doc.sync === 'line' ? 2 : 1;
    return base * 10 + (doc.provider === 'better' ? 1 : 0);
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

  async fromBetterLyrics(meta) {
    if (!this.relay) return null;
    const hosts = ['https://api.betterlyrics.org', 'https://lyrics-api.boidu.dev'];
    for (const host of hosts) {
      const result = await this.tryBetterHost(host, meta);
      if (result !== undefined) return result; // null = backend menjawab (cache miss)
    }
    return null;
  }

  /** @returns {Promise<object|null|undefined>} undefined = relay gagal total. */
  async tryBetterHost(host, meta) {
    const base = new URLSearchParams();
    base.set('s', meta.title);
    if (meta.artist) base.set('a', meta.artist);

    const variants = [];
    const full = new URLSearchParams(base);
    if (meta.duration > 0) full.set('d', String(meta.duration));
    if (meta.videoId) full.set('videoId', meta.videoId);
    variants.push(full);
    if (meta.duration > 0) variants.push(new URLSearchParams(base)); // tanpa durasi

    for (const params of variants) {
      const json = await this.relayWithTimeout(`${host}/getLyrics?${params.toString()}`);
      if (!json) continue; // relay gagal — coba variasi berikutnya
      if (json.ttml) {
        const parsed = this.parseTtml(json.ttml);
        if (parsed && parsed.lines.length) {
          return {
            provider: 'better',
            sync: parsed.sync,
            lines: parsed.lines,
            title: meta.title,
            artist: meta.artist,
            ts: Date.now(),
          };
        }
      }
      if (json.error) return null; // 401/404 — tidak akan beda untuk variasi lain
    }
    return undefined;
  }

  relayWithTimeout(url, timeoutMs = 18000) {
    if (!this.relay) return Promise.resolve(null);
    return Promise.race([
      this.relay(url).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  /* ================= Sumber 2: LRCLIB ================= */

  async fromLrclib(meta) {
    const api = 'https://lrclib.net/api';

    // 1) Pencocokan persis (durasi membuat pencocokan lebih ketat).
    if (meta.artist) {
      const exact = new URLSearchParams();
      exact.set('artist_name', meta.artist);
      exact.set('track_name', meta.title);
      if (meta.duration > 0) exact.set('duration', String(meta.duration));
      const doc = await this.tryLrclibGet(`${api}/get?${exact.toString()}`, meta);
      if (doc) return doc;
    }

    // 2) Pencarian artist + judul.
    const s1 = new URLSearchParams();
    if (meta.artist) s1.set('artist_name', meta.artist);
    s1.set('track_name', meta.title);
    const found1 = await this.lrclibSearch(`${api}/search?${s1.toString()}`, meta);
    if (found1) return found1;

    // 3) Judul asli (masih ada embel-embel) via q=.
    if (meta.rawTitle && meta.rawTitle.toLowerCase() !== meta.title.toLowerCase()) {
      const s2 = new URLSearchParams({ q: meta.rawTitle });
      const found2 = await this.lrclibSearch(`${api}/search?${s2.toString()}`, meta);
      if (found2) return found2;
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
