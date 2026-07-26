/* OTOMATİK KOPYA — kaynak: shared/core-api.js. Elle düzenleme, shared/ içindekini düzenle. */
/* core-api.js — Supabase REST/Auth/Storage için bağımlılıksız istemci (fetch tabanlı).
   SDK yerine düz fetch: hem web hem Android WebView'de aynı, ~200 KB paket yok. */

import { CONFIG } from './config.js';

const SESSION_KEY = 'saglik-panel/session';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Sunucu hatalarını Türkçeleştir. */
function humanize(status, body) {
  const msg = String(body?.msg || body?.message || body?.error_description || body?.error || '');
  const f = msg.toLowerCase();
  if (f.includes('invalid login credentials')) return 'E-posta veya şifre yanlış.';
  if (f.includes('user already registered') || f.includes('already been registered')) {
    return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.';
  }
  if (f.includes('password should be at least')) return 'Şifre en az 6 karakter olmalı.';
  if (f.includes('email address') && f.includes('invalid')) return 'E-posta adresi geçersiz görünüyor.';
  if (f.includes('duplicate key') && f.includes('username')) return 'Bu kullanıcı adı alınmış.';
  if (f.includes('gecersiz token')) return 'Gönderim anahtarı geçersiz. Web panelinden yenile.';
  if (status === 401 || status === 403) return 'Oturum geçersiz. Yeniden giriş yapmalısın.';
  if (status === 413) return 'Dosya çok büyük (en fazla 10 MB).';
  if (status >= 500) return 'Sunucu şu an yanıt vermiyor, sonra tekrar dene.';
  return msg || `İstek başarısız (${status}).`;
}

export const isConfigured = () => !!(CONFIG.url && CONFIG.anonKey);

export class Api {
  constructor(cfg = CONFIG) {
    this.url = String(cfg.url || '').replace(/\/+$/, '');
    this.anonKey = cfg.anonKey || '';
    this.session = this._loadSession();
  }

  /* ---------------- oturum ---------------- */

  _loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  _saveSession(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* yoksay */ }
  }

  get userId() { return this.session?.user?.id || null; }
  get email() { return this.session?.user?.email || null; }
  isLoggedIn() { return !!this.session?.access_token; }

  _storeAuth(data) {
    if (!data?.access_token) throw new ApiError('Oturum açılamadı', 400, data);
    this._saveSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
      user: { id: data.user?.id, email: data.user?.email },
    });
    return this.session;
  }

  async signUp(email, password, username) {
    const data = await this._raw('POST', '/auth/v1/signup', {
      email: String(email).trim(),
      password,
      data: { username: String(username || '').trim() },
    });
    // "Confirm email" kapalıysa token doğrudan gelir; açıksa giriş gerekir
    if (data?.access_token) return this._storeAuth(data);
    return this.signIn(email, password);
  }

  async signIn(email, password) {
    const data = await this._raw('POST', '/auth/v1/token?grant_type=password', {
      email: String(email).trim(),
      password,
    });
    return this._storeAuth(data);
  }

  async signOut() {
    try {
      if (this.session?.access_token) {
        await this._raw('POST', '/auth/v1/logout', {}, {
          Authorization: `Bearer ${this.session.access_token}`,
        });
      }
    } catch (e) { /* yerelde yine kapat */ }
    this._saveSession(null);
  }

  async refresh() {
    if (!this.session?.refresh_token) throw new ApiError('Oturum yok', 401);
    const data = await this._raw('POST', '/auth/v1/token?grant_type=refresh_token', {
      refresh_token: this.session.refresh_token,
    });
    return this._storeAuth(data);
  }

  async ensureToken() {
    if (!this.session?.access_token) throw new ApiError('Giriş yapılmadı', 401);
    if (Date.now() >= (this.session.expires_at || 0)) await this.refresh();
    return this.session.access_token;
  }

  /* ---------------- alt seviye ---------------- */

  async _raw(method, path, body, extraHeaders = {}) {
    if (!this.url) throw new ApiError('Supabase ayarlanmadı', 0);
    const res = await fetch(this.url + path, {
      method,
      headers: {
        apikey: this.anonKey,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok) throw new ApiError(humanize(res.status, data), res.status, data);
    return data;
  }

  /** Kimlikli istek; 401'de bir kez token yenileyip tekrar dener. */
  async _authed(method, path, body, extraHeaders = {}, retry = true) {
    const token = await this.ensureToken();
    try {
      return await this._raw(method, path, body, {
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      });
    } catch (e) {
      if (retry && e.status === 401) {
        await this.refresh();
        return this._authed(method, path, body, extraHeaders, false);
      }
      throw e;
    }
  }

  /* ---------------- veri ---------------- */

  select(table, query = '') {
    const q = query ? (query.startsWith('?') ? query : '?' + query) : '?select=*';
    return this._authed('GET', `/rest/v1/${table}${q}`);
  }

  upsert(table, rows, { onConflict = null } = {}) {
    const list = Array.isArray(rows) ? rows : [rows];
    const q = onConflict ? `?on_conflict=${onConflict}` : '';
    return this._authed('POST', `/rest/v1/${table}${q}`, list, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    });
  }

  patch(table, query, values) {
    return this._authed('PATCH', `/rest/v1/${table}?${query}`, values, {
      Prefer: 'return=representation',
    });
  }

  remove(table, query) {
    return this._authed('DELETE', `/rest/v1/${table}?${query}`);
  }

  rpc(fn, args = {}) {
    return this._authed('POST', `/rest/v1/rpc/${fn}`, args);
  }

  /** Token ile (oturumsuz) çağrı — kısayolun kullandığı yol; testte de işe yarar. */
  rpcAnon(fn, args = {}) {
    return this._raw('POST', `/rest/v1/rpc/${fn}`, args);
  }

  /* ---------------- profil ---------------- */

  async getProfile() {
    const rows = await this.select('sp_profiles', 'select=*&limit=1');
    return rows?.[0] || null;
  }

  async saveProfile(patch) {
    const id = this.userId;
    if (!id) throw new ApiError('Giriş yapılmadı', 401);
    const rows = await this.upsert('sp_profiles', { id, ...patch }, { onConflict: 'id' });
    return rows?.[0] || null;
  }

  rotateIngestToken() { return this.rpc('sp_rotate_ingest_token'); }

  /* ---------------- hesap silme ---------------- */

  /** Silinecek verinin özeti. Sunucu tarafı kurulu değilse null döner. */
  async accountSummary() {
    try {
      const rows = await this.rpc('sp_account_summary');
      return Array.isArray(rows) ? rows[0] || null : rows || null;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Hesabı ve tüm sunucu verisini kalıcı olarak siler.
   * Önce depolamadaki görseller tek tek silinir (bunlar cascade edilmiyor),
   * sonra auth kullanıcısı silinir — o da tüm sp_* satırlarını götürür.
   * Sonunda yerel oturum kapatılır.
   */
  async deleteAccount() {
    if (!this.isLoggedIn()) throw new ApiError('Giriş yapılmadı', 401);

    // 1) Depolama klasörü
    try {
      const files = await this.listImages();
      for (const f of files) {
        try { await this.deleteImage(f); } catch (e) { /* sunucu tarafı da temizliyor */ }
      }
    } catch (e) { /* listelenemezse devam et */ }

    // 2) Hesabı sil
    let result = null;
    try {
      result = await this.rpc('sp_delete_account');
    } catch (e) {
      if (e.status === 404) {
        throw new ApiError(
          'Hesap silme sunucu tarafı kurulu değil. db/schema-delete-account.sql çalıştırılmalı.',
          501,
        );
      }
      throw e;
    }

    // 3) Yerel oturumu kapat (jeton zaten geçersiz)
    this._saveSession(null);
    return result;
  }

  /** Kullanıcının kendi klasöründeki dosya yolları. */
  async listImages() {
    const id = this.userId;
    if (!id) return [];
    const rows = await this._authed('POST', `/storage/v1/object/list/${CONFIG.bucket}`, {
      prefix: `${id}/`, limit: 500, offset: 0,
    });
    return (rows || []).filter((r) => r?.name).map((r) => `${id}/${r.name}`);
  }

  /** Profil satırı yoksa oluştur (şema sonradan kurulmuş bir projede hesap zaten varsa). */
  async ensureProfile(fallbackName = null) {
    let prof = await this.getProfile();
    if (prof) return prof;
    const base = (fallbackName || (this.email || 'kullanici').split('@')[0] || 'kullanici')
      .replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 18) || 'kullanici';
    const uname = `${base}${String(this.userId || '').replace(/-/g, '').slice(0, 4)}`;
    prof = await this.saveProfile({ username: uname });
    return prof || this.getProfile();
  }

  /* ---------------- depolama ---------------- */

  async uploadImage(path, blob, contentType = 'image/jpeg') {
    const token = await this.ensureToken();
    const res = await fetch(`${this.url}/storage/v1/object/${CONFIG.bucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: blob,
    });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (e) { /* */ }
      throw new ApiError(humanize(res.status, body), res.status, body);
    }
    return path;
  }

  async signedUrl(path, expiresIn = 3600) {
    const data = await this._authed('POST', `/storage/v1/object/sign/${CONFIG.bucket}/${path}`,
      { expiresIn });
    const signed = data?.signedURL || data?.signedUrl;
    if (!signed) throw new ApiError('İmzalı adres alınamadı', 500, data);
    return this.url + '/storage/v1' + (signed.startsWith('/') ? signed : '/' + signed);
  }

  /** Android tarafında OCR için görseli indirir. */
  async downloadImage(path) {
    const token = await this.ensureToken();
    const res = await fetch(`${this.url}/storage/v1/object/${CONFIG.bucket}/${path}`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiError(humanize(res.status, null), res.status, null);
    return res.blob();
  }

  deleteImage(path) {
    return this._authed('DELETE', `/storage/v1/object/${CONFIG.bucket}/${path}`);
  }

  /* ---------------- yüklemeler kuyruğu ---------------- */

  pendingUploads(limit = 20) {
    return this.select('sp_uploads',
      `select=*&status=eq.pending&order=created_at.asc&limit=${limit}`);
  }

  markUpload(id, patch) {
    return this.patch('sp_uploads', `id=eq.${id}`, {
      ...patch,
      processed_at: new Date().toISOString(),
    });
  }

  /* ---------------- kısayol yardımcıları ---------------- */

  /** Kısayolun POST edeceği adres. */
  ingestEndpoint(fn = 'sp_ingest_activity') {
    return `${this.url}/rest/v1/rpc/${fn}`;
  }

  /** Kısayol kurulum metni için örnek gövde. */
  ingestBodyTemplate(token) {
    return {
      p_token: token || '<ingest_token>',
      p_day: '2026-07-25',
      p_steps: 8432,
      p_distance_km: 6.1,
      p_active_kcal: 455,
      p_exercise_min: 32,
      p_stand_hours: 11,
    };
  }
}

export const api = new Api();
