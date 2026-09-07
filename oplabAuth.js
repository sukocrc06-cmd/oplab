/**
 * ═══════════════════════════════════════════════════════════════════════════
 * oplab — Bağımsız E-posta Girişi + Cihazlar Arası Senkronizasyon
 * (7 Eylül 2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bu dosya, canlı yarışma sitesinin (finte-bf5f7) eski finteclubBridge.js'inin
 * YERİNE GEÇMİYOR — o dosya bu bağımsız "oplab" kopyasından tamamen
 * kaldırıldı (bkz. index.html'deki ilgili yorumlar). Bunun yerine bu proje
 * için sıfırdan kurulmuş, TAMAMEN AYRI bir Firebase projesiyle (bkz.
 * oplabFirebaseConfig.js) çalışan, kendi kimlik doğrulama + senkronizasyon
 * katmanı.
 *
 * NASIL ÇALIŞIR (özet):
 *   1) Sayfa açılır açılmaz tam ekran bir "giriş kapısı" (#oplab-auth-gate)
 *      görünür durumda başlar (index.html'de "hidden" class'ı YOK) — oturum
 *      durumu netleşene kadar altındaki uygulamanın motoru da başlamaz
 *      (bkz. aşağıdaki __oplabRegisterStart / index.html'deki DOMContentLoaded
 *      handler'ı).
 *   2) Firebase yapılandırılmamışsa (oplabFirebaseConfig.js hâlâ yer
 *      tutucu değerlerdeyse) kapı hiç gösterilmeden otomatik "misafir
 *      modu"na düşülür — site bu yüzden ASLA bozulmaz.
 *   3) Firebase yapılandırılmışsa: kullanıcı daha önce giriş yapmışsa
 *      (Firebase oturumu tarayıcıda kalıcıdır) otomatik devam eder;
 *      yapmamışsa kapı açık kalır, kullanıcı giriş yapar/kayıt olur ya da
 *      "misafir olarak devam et" der.
 *   4) Giriş yapıldığında Firestore'daki `users/{uid}` belgesindeki
 *      portföy/izleme listesi/profil adı, tarayıcının localStorage'ına
 *      YAZILIR (mevcut motor kodu — tradingEngine.js — bu localStorage
 *      anahtarlarını zaten olduğu gibi okuyor, HİÇ değiştirilmedi).
 *   5) O andan sonra bu üç anahtardan biri her değiştiğinde (alım/satım,
 *      izleme listesi güncellemesi, profil adı değişikliği) ~1.2 saniye
 *      gecikmeyle Firestore'a otomatik yazılır — başka bir cihazda tekrar
 *      giriş yapıldığında aynı veri oradan geri yüklenir.
 *
 * Mevcut motor koduna (tradingEngine.js/tradingChart.js/app.js) TEK BİR
 * SATIR bile dokunulmadı — senkronizasyon tamamen localStorage okuma/yazma
 * seviyesinde, dışarıdan/görünmez şekilde yapılıyor.
 */
'use strict';

(function () {

    /* ────────────── Motoru başlatma "el sıkışması" ──────────────
     * index.html'deki DOMContentLoaded handler'ı, motor başlatma
     * (TradingChart/TradingEngine/TourGuide.init()) fonksiyonunu doğrudan
     * çağırmak yerine window.__oplabRegisterStart(fn) ile burada
     * kaydediyor. Oturum durumu netleşip (misafir ya da giriş yapılmış)
     * localStorage senkronize edildikten SONRA biz fn()'i çağırıyoruz.
     * Hangisi önce gerçekleşirse gerçekleşsin (DOMContentLoaded mı,
     * Firebase'in oturum kontrolü mü) sıra hiç bozulmuyor. */
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
    // Güvenlik freni: oplabAuth.js herhangi bir sebeple (beklenmedik hata,
    // ağ sorunu vb.) hiçbir zaman motoru SONSUZA KADAR kilitli bırakmasın —
    // 6 saniye içinde bir karar verilmediyse misafir modunda devam et.
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
    // localStorage anahtarı -> Firestore alan adı eşlemesi. Her ikisi de
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

    /* ────────────── Firebase hata kodlarını Türkçe'ye çevirme ────────────── */
    function mapFirebaseError(err) {
        const code = err && err.code ? err.code : '';
        switch (code) {
            case 'auth/invalid-email': return 'E-posta adresi geçersiz görünüyor.';
            case 'auth/user-not-found': return 'Bu e-posta ile kayıtlı bir hesap bulunamadı.';
            case 'auth/wrong-password': return 'Şifre hatalı.';
            case 'auth/invalid-credential': return 'E-posta veya şifre hatalı.';
            case 'auth/email-already-in-use': return 'Bu e-posta ile zaten bir hesap var — "Giriş Yap" sekmesini dene.';
            case 'auth/weak-password': return 'Şifre en az 6 karakter olmalı.';
            case 'auth/too-many-requests': return 'Çok fazla deneme yapıldı, lütfen biraz sonra tekrar dene.';
            case 'auth/network-request-failed': return 'Ağ bağlantısı sorunu — internetini kontrol et.';
            case 'auth/operation-not-allowed': return 'E-posta/şifre girişi bu Firebase projesinde henüz etkinleştirilmemiş (Authentication → Sign-in method → Email/Password → Enable).';
            default: return err && err.message ? err.message : 'Beklenmeyen bir hata oluştu, tekrar dener misin?';
        }
    }

    /* ────────────── Firebase kurulumu ────────────── */
    let auth = null;
    let db = null;
    let currentUser = null;

    function isConfigured() {
        const c = window.OPLAB_FIREBASE_CONFIG;
        return !!(c && c.apiKey && c.apiKey.indexOf('BURAYA_YAPISTIR') === -1 &&
                  c.projectId && c.projectId.indexOf('BURAYA_YAPISTIR') === -1);
    }

    function initFirebase() {
        if (!isConfigured() || typeof firebase === 'undefined') return false;
        try {
            if (!firebase.apps.length) firebase.initializeApp(window.OPLAB_FIREBASE_CONFIG);
            auth = firebase.auth();
            db = firebase.firestore();
            return true;
        } catch (e) {
            console.error('[oplabAuth] Firebase başlatılamadı:', e);
            return false;
        }
    }

    /* ────────────── Firestore <-> localStorage senkronizasyonu ────────────── */
    let pushTimer = null;
    let pendingFields = {};

    function schedulePush(field, value) {
        if (!currentUser || !db) return;
        pendingFields[field] = value;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(flushPush, 1200);
    }
    function flushPush() {
        pushTimer = null;
        if (!currentUser || !db) { pendingFields = {}; return; }
        const fields = pendingFields;
        pendingFields = {};
        if (!Object.keys(fields).length) return;
        fields.email = currentUser.email;
        fields.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        db.collection('users').doc(currentUser.uid).set(fields, { merge: true })
            .catch(e => console.warn('[oplabAuth] Senkron yazma hatası (verin bir sonraki değişiklikte tekrar denenecek):', e));
    }

    // localStorage.setItem'i, SADECE senkronize edilen 3 anahtar için
    // Firestore'a yazma tetikleyen bir sarmalayıcıyla değiştiriyoruz.
    // Diğer tüm anahtarlar (tema, ızgara düzeni, alarm ayarları vb.)
    // hiç etkilenmiyor, eskisi gibi sadece tarayıcıda kalıyor.
    Storage.prototype.setItem = function (key, value) {
        originalSetItem.call(this, key, value);
        if (this === localStorage) {
            const field = FIELD_MAP[key];
            if (field) schedulePush(field, value);
        }
    };

    async function pullFromFirestore(uid) {
        try {
            const snap = await db.collection('users').doc(uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                if (typeof data.portfolio === 'string') safeSetRaw(PORTFOLIO_KEY, data.portfolio);
                if (typeof data.watchlist === 'string') safeSetRaw(WATCHLIST_KEY, data.watchlist);
                if (typeof data.profileName === 'string') safeSetRaw(PROFILE_NAME_KEY, data.profileName);
            } else {
                // İlk giriş/kayıt: Firestore'da henüz belge yok — o an
                // tarayıcıda ne varsa (yeni kayıt olan biri için genelde
                // varsayılan demo bakiyesi) başlangıç noktası olarak yazılır.
                const seed = {
                    email: currentUser.email,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                const p = safeGet(PORTFOLIO_KEY); if (p !== null) seed.portfolio = p;
                const w = safeGet(WATCHLIST_KEY); if (w !== null) seed.watchlist = w;
                const n = safeGet(PROFILE_NAME_KEY); if (n !== null) seed.profileName = n;
                await db.collection('users').doc(uid).set(seed, { merge: true });
            }
        } catch (e) {
            console.error('[oplabAuth] Firestore senkron okuma hatası — yerel/varsayılan veriyle devam ediliyor:', e);
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
        if (accountStatusEl) accountStatusEl.textContent = 'E-posta girişi henüz kurulmadı (bkz. oplabFirebaseConfig.js).';
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
            if (!auth) return;
            accountLogoutBtn.disabled = true;
            auth.signOut().then(() => {
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
            if (!auth) { showStatus('Giriş sistemi henüz hazır değil, birazdan tekrar dene.', 'error'); return; }
            forgotBtn.disabled = true;
            auth.sendPasswordResetEmail(email)
                .then(() => showStatus('Şifre sıfırlama bağlantısı e-postana gönderildi.', 'info'))
                .catch(e => showStatus(mapFirebaseError(e), 'error'))
                .finally(() => { forgotBtn.disabled = false; });
        });
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!auth) { showStatus('Giriş sistemi henüz hazır değil, birazdan tekrar dene.', 'error'); return; }
            const email = (emailInput && emailInput.value || '').trim();
            const password = passwordInput ? passwordInput.value : '';
            if (!email || !password) { showStatus('E-posta ve şifre gerekli.', 'error'); return; }

            if (mode === 'signup') {
                const confirm = passwordConfirmInput ? passwordConfirmInput.value : '';
                if (password !== confirm) { showStatus('Şifreler eşleşmiyor.', 'error'); return; }
                submitBtn.disabled = true;
                clearStatus();
                auth.createUserWithEmailAndPassword(email, password)
                    .catch(err => { showStatus(mapFirebaseError(err), 'error'); })
                    .finally(() => { submitBtn.disabled = false; });
            } else {
                submitBtn.disabled = true;
                clearStatus();
                auth.signInWithEmailAndPassword(email, password)
                    .catch(err => { showStatus(mapFirebaseError(err), 'error'); })
                    .finally(() => { submitBtn.disabled = false; });
            }
            // Başarılı giriş/kayıt sonrası akış onAuthStateChanged'de devam
            // ediyor (Firestore'dan çekme + kapıyı kapatma + motoru başlatma).
        });
    }

    /* ────────────── Açılış: oturum durumunu belirle ────────────── */
    const configured = initFirebase();
    if (!configured) {
        renderAccountUnconfigured();
        finishAsGuest({ silent: true });
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await pullFromFirestore(user.uid);
            finishAsAuthenticated(user);
        } else {
            currentUser = null;
            if (safeGet(GUEST_FLAG_KEY) === '1') {
                finishAsGuest({ silent: true });
            } else {
                clearSafetyTimer();
                showGate();
                renderAccountGuest();
                // NOT: releaseStart() burada ÇAĞRILMIYOR — motor, kullanıcı
                // giriş yapana veya "misafir olarak devam et"e basana kadar
                // kasıtlı olarak beklemede kalıyor.
            }
        }
    }, (err) => {
        console.error('[oplabAuth] onAuthStateChanged hatası, misafir modunda devam ediliyor:', err);
        finishAsGuest({ silent: true });
    });

})();
