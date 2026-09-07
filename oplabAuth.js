/**
 * ═══════════════════════════════════════════════════════════════════════════
 * oplab — Bağımsız E-posta Girişi + Cihazlar Arası Senkronizasyon
 * (7 Eylül 2026 — Appwrite sürümü, üçüncü deneme)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sıra: Firebase (Google Cloud Console'un kendi tarafında çözülemeyen 401
 * "invalid authentication credentials" hatası — proje/Firestore/Rules
 * oluşturmanın HEPSİNDE) → Supabase (hesabın zaten 2 ücretsiz proje
 * limitine ulaşmış olması yeni proje açılmasını engelledi) → Appwrite
 * (bkz. oplabAppwriteConfig.js). Bu dosyanın mantığı öncekilerle AYNI,
 * sadece alt katman (Appwrite Web SDK) değişti.
 *
 * NASIL ÇALIŞIR (özet):
 *   1) Sayfa açılır açılmaz tam ekran bir "giriş kapısı" (#oplab-auth-gate)
 *      görünür durumda başlar — oturum durumu netleşene kadar altındaki
 *      uygulamanın motoru da başlamaz (bkz. __oplabRegisterStart /
 *      index.html'deki DOMContentLoaded handler'ı).
 *   2) Appwrite yapılandırılmamışsa (oplabAppwriteConfig.js hâlâ yer
 *      tutucu değerlerdeyse) kapı hiç gösterilmeden otomatik "misafir
 *      modu"na düşülür — site bu yüzden ASLA bozulmaz.
 *   3) Appwrite yapılandırılmışsa: tarayıcıda zaten bir oturum varsa
 *      (Appwrite oturumu çerez tabanlıdır, kalıcıdır) otomatik devam
 *      eder; yoksa kapı açık kalır, kullanıcı giriş yapar/kayıt olur ya
 *      da "misafir olarak devam et" der.
 *   4) Giriş yapıldığında Appwrite veritabanındaki kullanıcının kendi
 *      belgesi (users koleksiyonunda, belge ID'si = kullanıcının Appwrite
 *      $id'si), tarayıcının localStorage'ına YAZILIR (mevcut motor kodu —
 *      tradingEngine.js — bu localStorage anahtarlarını zaten olduğu gibi
 *      okuyor, HİÇ değiştirilmedi).
 *   5) O andan sonra bu üç anahtardan biri her değiştiğinde (alım/satım,
 *      izleme listesi güncellemesi, profil adı değişikliği) ~1.2 saniye
 *      gecikmeyle Appwrite'a otomatik yazılır — başka bir cihazda tekrar
 *      giriş yapıldığında aynı veri oradan geri yüklenir.
 *
 * Mevcut motor koduna (tradingEngine.js/tradingChart.js/app.js) TEK BİR
 * SATIR bile dokunulmadı — senkronizasyon tamamen localStorage okuma/yazma
 * seviyesinde, dışarıdan/görünmez şekilde yapılıyor.
 */
'use strict';

(function () {

    /* ────────────── Motoru başlatma "el sıkışması" ────────────── */
    let pendingStart = null;
    let readyToStart = false;
    window.__oplabRegisterStart = function (fn) {
        if (typeof fn !== 'function') return;
        if (readyToStart) { fn(); return; }
        pendingStart = fn;
    };
    function releaseStart() {
        if (readyToStart) return;
        readyToStart = true;
        if (pendingStart) {
            const fn = pendingStart;
            pendingStart = null;
            fn();
        }
    }
    // Güvenlik freni: oplabAuth.js herhangi bir sebeple motoru SONSUZA
    // KADAR kilitli bırakmasın — 6 saniye içinde bir karar verilmediyse
    // misafir modunda devam et.
    const SAFETY_TIMEOUT_MS = 6000;
    let safetyTimer = setTimeout(() => {
        console.warn('[oplabAuth] Oturum durumu zaman aşımına uğradı, misafir modunda devam ediliyor.');
        finishAsGuest({ silent: true });
    }, SAFETY_TIMEOUT_MS);
    function clearSafetyTimer() {
        if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
    }

    /* ────────────── localStorage anahtarları (mevcut motor koduyla AYNI) ────────────── */
    const PORTFOLIO_KEY = 'optipulselab_paper_portfolio_v1';
    const WATCHLIST_KEY = 'optipulselab_watchlist_symbols_v1';
    const PROFILE_NAME_KEY = 'optipulselab_profile_name_v1';
    const GUEST_FLAG_KEY = 'oplab_guest_mode_v1';
    // localStorage anahtarı -> Appwrite belge alanı eşlemesi. Her ikisi de
    // ham STRING olarak taşınıyor (JSON.parse/stringify YOK) — böylece
    // motor kodunun bu değerleri hangi formatta sakladığından (JSON dizisi,
    // JSON nesnesi, düz metin) TAMAMEN bağımsız, format-agnostik çalışıyor.
    const FIELD_MAP = {
        [PORTFOLIO_KEY]: 'portfolio',
        [WATCHLIST_KEY]: 'watchlist',
        [PROFILE_NAME_KEY]: 'profileName'
    };

    const originalGetItem = Storage.prototype.getItem.bind(localStorage);
    const originalSetItem = Storage.prototype.setItem.bind(localStorage);

    function safeGet(key) {
        try { return originalGetItem(key); } catch (e) { return null; }
    }
    function safeSetRaw(key, value) {
        try { originalSetItem(key, value); } catch (e) { /* private mode / kota */ }
    }

    /* ────────────── DOM referansları ────────────── */
    const gate = document.getElementById('oplab-auth-gate');
    const tabLogin = document.getElementById('oplab-tab-login');
    const tabSignup = document.getElementById('oplab-tab-signup');
    const form = document.getElementById('oplab-auth-form');
    const emailInput = document.getElementById('oplab-auth-email');
    const passwordInput = document.getElementById('oplab-auth-password');
    const passwordConfirmInput = document.getElementById('oplab-auth-password-confirm');
    const submitBtn = document.getElementById('oplab-auth-submit');
    const forgotBtn = document.getElementById('oplab-auth-forgot');
    const statusEl = document.getElementById('oplab-auth-status');
    const skipBtn = document.getElementById('oplab-auth-skip');

    const accountStatusEl = document.getElementById('oplab-account-status');
    const accountLoginBtn = document.getElementById('oplab-account-login-btn');
    const accountLogoutBtn = document.getElementById('oplab-account-logout-btn');

    let mode = 'login'; // 'login' | 'signup'

    function setMode(newMode) {
        mode = newMode;
        const isSignup = mode === 'signup';
        if (tabLogin) tabLogin.classList.toggle('active', !isSignup);
        if (tabSignup) tabSignup.classList.toggle('active', isSignup);
        if (passwordConfirmInput) passwordConfirmInput.classList.toggle('hidden', !isSignup);
        if (forgotBtn) forgotBtn.classList.toggle('hidden', isSignup);
        if (submitBtn) submitBtn.textContent = isSignup ? 'Kayıt Ol' : 'Giriş Yap';
        clearStatus();
    }
    if (tabLogin) tabLogin.addEventListener('click', () => setMode('login'));
    if (tabSignup) tabSignup.addEventListener('click', () => setMode('signup'));

    function showStatus(msg, kind) {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.remove('is-error', 'is-info');
        if (kind) statusEl.classList.add(kind === 'error' ? 'is-error' : 'is-info');
    }
    function clearStatus() { showStatus('', null); }

    function showGate() { if (gate) gate.classList.remove('hidden'); }
    function hideGate() { if (gate) gate.classList.add('hidden'); }

    /* ────────────── Appwrite hatalarını Türkçe'ye çevirme ────────────── */
    function mapAppwriteError(err) {
        const type = err && err.type ? err.type : '';
        const code = err && err.code ? err.code : null;
        switch (type) {
            case 'user_invalid_credentials': return 'E-posta veya şifre hatalı.';
            case 'user_already_exists':
            case 'user_email_already_exists': return 'Bu e-posta ile zaten bir hesap var — "Giriş Yap" sekmesini dene.';
            case 'user_password_mismatch': return 'Şifreler eşleşmiyor.';
            case 'password_recently_used':
            case 'password_personal_data': return 'Bu şifre kullanılamaz, farklı bir şifre dene.';
            case 'general_argument_invalid': return 'Girilen bilgiler geçersiz görünüyor (e-posta formatını ve şifre uzunluğunu kontrol et — şifre en az 8 karakter olmalı).';
            case 'general_rate_limit_exceeded': return 'Çok fazla deneme yapıldı, lütfen biraz sonra tekrar dene.';
            case 'user_not_found': return 'Bu e-posta ile kayıtlı bir hesap bulunamadı.';
            default:
                if (code === 401) return 'E-posta veya şifre hatalı.';
                if (code === 409) return 'Bu e-posta ile zaten bir hesap var — "Giriş Yap" sekmesini dene.';
                return err && err.message ? err.message : 'Beklenmeyen bir hata oluştu, tekrar dener misin?';
        }
    }

    /* ────────────── Appwrite kurulumu ────────────── */
    let client = null;
    let account = null;
    let databases = null;
    let currentUser = null;

    function isConfigured() {
        const c = window.OPLAB_APPWRITE_CONFIG;
        return !!(c && c.endpoint && c.projectId &&
                  c.projectId.indexOf('BURAYA_YAPISTIR') === -1 &&
                  c.databaseId && c.collectionId);
    }

    function initAppwrite() {
        if (!isConfigured() || typeof Appwrite === 'undefined') return false;
        try {
            const cfg = window.OPLAB_APPWRITE_CONFIG;
            client = new Appwrite.Client();
            client.setEndpoint(cfg.endpoint).setProject(cfg.projectId);
            account = new Appwrite.Account(client);
            databases = new Appwrite.Databases(client);
            return true;
        } catch (e) {
            console.error('[oplabAuth] Appwrite başlatılamadı:', e);
            return false;
        }
    }

    /* ────────────── Appwrite <-> localStorage senkronizasyonu ────────────── */
    let pushTimer = null;
    let pendingFields = {};

    function schedulePush(field, value) {
        if (!currentUser || !databases) return;
        pendingFields[field] = value;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(flushPush, 1200);
    }
    function docPermissions(uid) {
        return [
            Appwrite.Permission.read(Appwrite.Role.user(uid)),
            Appwrite.Permission.update(Appwrite.Role.user(uid)),
            Appwrite.Permission.delete(Appwrite.Role.user(uid))
        ];
    }
    function flushPush() {
        pushTimer = null;
        if (!currentUser || !databases) { pendingFields = {}; return; }
        const fields = pendingFields;
        pendingFields = {};
        if (!Object.keys(fields).length) return;
        const cfg = window.OPLAB_APPWRITE_CONFIG;
        databases.updateDocument(cfg.databaseId, cfg.collectionId, currentUser.$id, fields)
            .catch(err => {
                // Belge henüz yoksa (ör. ilk senkron denemesi bir yarış
                // durumuna denk geldiyse) oluşturarak devam et.
                if (err && err.code === 404) {
                    fields.email = currentUser.email;
                    databases.createDocument(cfg.databaseId, cfg.collectionId, currentUser.$id, fields, docPermissions(currentUser.$id))
                        .catch(e2 => console.warn('[oplabAuth] Senkron yazma hatası (bir sonraki değişiklikte tekrar denenecek):', e2));
                } else {
                    console.warn('[oplabAuth] Senkron yazma hatası (bir sonraki değişiklikte tekrar denenecek):', err);
                }
            });
    }

    async function pullFromAppwrite(user) {
        const cfg = window.OPLAB_APPWRITE_CONFIG;
        try {
            const doc = await databases.getDocument(cfg.databaseId, cfg.collectionId, user.$id);
            if (typeof doc.portfolio === 'string') safeSetRaw(PORTFOLIO_KEY, doc.portfolio);
            if (typeof doc.watchlist === 'string') safeSetRaw(WATCHLIST_KEY, doc.watchlist);
            if (typeof doc.profileName === 'string') safeSetRaw(PROFILE_NAME_KEY, doc.profileName);
        } catch (e) {
            if (e && e.code === 404) {
                // İlk giriş/kayıt: Appwrite'da henüz belge yok — o an
                // tarayıcıda ne varsa başlangıç noktası olarak yazılır.
                const seed = { email: user.email };
                const p = safeGet(PORTFOLIO_KEY); if (p !== null) seed.portfolio = p;
                const w = safeGet(WATCHLIST_KEY); if (w !== null) seed.watchlist = w;
                const n = safeGet(PROFILE_NAME_KEY); if (n !== null) seed.profileName = n;
                try {
                    await databases.createDocument(cfg.databaseId, cfg.collectionId, user.$id, seed, docPermissions(user.$id));
                } catch (e2) {
                    console.error('[oplabAuth] Appwrite ilk belge oluşturma hatası:', e2);
                }
            } else {
                console.error('[oplabAuth] Appwrite senkron okuma hatası — yerel/varsayılan veriyle devam ediliyor:', e);
            }
        }
    }

    /* ────────────── Hesap bölümü (profil paneli) ────────────── */
    function renderAccountLoggedIn(email) {
        if (accountStatusEl) accountStatusEl.textContent = 'Giriş yapıldı: ' + email;
        if (accountLoginBtn) accountLoginBtn.classList.add('hidden');
        if (accountLogoutBtn) accountLogoutBtn.classList.remove('hidden');
    }
    function renderAccountGuest() {
        if (accountStatusEl) accountStatusEl.textContent = 'Misafir modu — veriler sadece bu tarayıcıda saklanıyor.';
        if (accountLoginBtn) accountLoginBtn.classList.remove('hidden');
        if (accountLogoutBtn) accountLogoutBtn.classList.add('hidden');
    }
    function renderAccountUnconfigured() {
        if (accountStatusEl) accountStatusEl.textContent = 'E-posta girişi henüz kurulmadı (bkz. oplabAppwriteConfig.js).';
        if (accountLoginBtn) accountLoginBtn.classList.add('hidden');
        if (accountLogoutBtn) accountLogoutBtn.classList.add('hidden');
    }

    if (accountLoginBtn) {
        accountLoginBtn.addEventListener('click', () => {
            safeSetRaw(GUEST_FLAG_KEY, '');
            clearStatus();
            showGate();
        });
    }
    if (accountLogoutBtn) {
        accountLogoutBtn.addEventListener('click', () => {
            if (!account) return;
            accountLogoutBtn.disabled = true;
            account.deleteSession('current').then(() => {
                safeSetRaw(GUEST_FLAG_KEY, '');
                location.reload();
            }).catch(e => {
                accountLogoutBtn.disabled = false;
                console.error('[oplabAuth] Çıkış yapılamadı:', e);
            });
        });
    }

    /* ────────────── Giriş kapısı: form / buton olayları ────────────── */
    function finishAsGuest(opts) {
        clearSafetyTimer();
        safeSetRaw(GUEST_FLAG_KEY, '1');
        hideGate();
        renderAccountGuest();
        releaseStart();
        if (!(opts && opts.silent)) clearStatus();
    }

    function finishAsAuthenticated(user) {
        clearSafetyTimer();
        currentUser = user;
        hideGate();
        renderAccountLoggedIn(user.email);
        releaseStart();
    }

    if (skipBtn) {
        skipBtn.addEventListener('click', () => finishAsGuest());
    }

    if (forgotBtn) {
        forgotBtn.addEventListener('click', () => {
            const email = (emailInput && emailInput.value || '').trim();
            if (!email) { showStatus('Önce e-posta adresini yaz, sonra "Şifremi unuttum"a bas.', 'error'); return; }
            if (!account) { showStatus('Giriş sistemi henüz hazır değil, birazdan tekrar dene.', 'error'); return; }
            forgotBtn.disabled = true;
            const redirectUrl = window.location.origin + '/reset-password.html';
            account.createRecovery(email, redirectUrl)
                .then(() => showStatus('Şifre sıfırlama bağlantısı e-postana gönderildi.', 'info'))
                .catch(e => showStatus(mapAppwriteError(e), 'error'))
                .finally(() => { forgotBtn.disabled = false; });
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!account) { showStatus('Giriş sistemi henüz hazır değil, birazdan tekrar dene.', 'error'); return; }
            const email = (emailInput && emailInput.value || '').trim();
            const password = passwordInput ? passwordInput.value : '';
            if (!email || !password) { showStatus('E-posta ve şifre gerekli.', 'error'); return; }

            if (mode === 'signup') {
                const confirm = passwordConfirmInput ? passwordConfirmInput.value : '';
                if (password !== confirm) { showStatus('Şifreler eşleşmiyor.', 'error'); return; }
                if (password.length < 8) { showStatus('Şifre en az 8 karakter olmalı.', 'error'); return; }
                submitBtn.disabled = true;
                clearStatus();
                account.create(Appwrite.ID.unique(), email, password)
                    .then(() => account.createEmailPasswordSession(email, password))
                    .then(() => account.get())
                    .then(async (user) => {
                        await pullFromAppwrite(user);
                        finishAsAuthenticated(user);
                    })
                    .catch(err => { showStatus(mapAppwriteError(err), 'error'); })
                    .finally(() => { submitBtn.disabled = false; });
            } else {
                submitBtn.disabled = true;
                clearStatus();
                account.createEmailPasswordSession(email, password)
                    .then(() => account.get())
                    .then(async (user) => {
                        await pullFromAppwrite(user);
                        finishAsAuthenticated(user);
                    })
                    .catch(err => { showStatus(mapAppwriteError(err), 'error'); })
                    .finally(() => { submitBtn.disabled = false; });
            }
        });
    }

    // localStorage.setItem'i, SADECE senkronize edilen 3 anahtar için
    // Appwrite'a yazma tetikleyen bir sarmalayıcıyla değiştiriyoruz.
    // Diğer tüm anahtarlar (tema, ızgara düzeni, alarm ayarları vb.)
    // hiç etkilenmiyor, eskisi gibi sadece tarayıcıda kalıyor.
    Storage.prototype.setItem = function (key, value) {
        originalSetItem.call(this, key, value);
        if (this === localStorage) {
            const field = FIELD_MAP[key];
            if (field) schedulePush(field, value);
        }
    };

    /* ────────────── Açılış: oturum durumunu belirle ────────────── */
    const configured = initAppwrite();
    if (!configured) {
        renderAccountUnconfigured();
        finishAsGuest({ silent: true });
    } else {
        account.get()
            .then(async (user) => {
                await pullFromAppwrite(user);
                finishAsAuthenticated(user);
            })
            .catch(() => {
                currentUser = null;
                if (safeGet(GUEST_FLAG_KEY) === '1') {
                    finishAsGuest({ silent: true });
                } else {
                    clearSafetyTimer();
                    showGate();
                    renderAccountGuest();
                    // NOT: releaseStart() burada ÇAĞRILMIYOR — motor,
                    // kullanıcı giriş yapana veya "misafir olarak devam
                    // et"e basana kadar kasıtlı olarak beklemede kalıyor.
                }
            });
    }

})();
