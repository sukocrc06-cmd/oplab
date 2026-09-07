/* ════════════════════════════════════════════════════════════════════
   oplab — Firebase Yapılandırması (Kimlik Doğrulama + Senkronizasyon)
   (7 Eylül 2026)

   Bu proje kendi AYRI Firebase projesini kullanıyor — canlı yarışma
   sitesinin Firebase projesiyle (finte-bf5f7) HİÇBİR ilgisi yok, tamamen
   bağımsız. Aşağıdaki yer tutucu değerleri kendi yeni Firebase projenden
   alıp buraya yapıştırman yeterli:

     1) https://console.firebase.google.com → "Add project" → proje adı
        (ör. "oplab") → Google Analytics'i istersen kapat (gerekmiyor).
     2) Proje açıldıktan sonra: Build → Authentication → Get started →
        "Sign-in method" sekmesi → "Email/Password" sağlayıcısını seç →
        Enable → Save.
     3) Build → Firestore Database → Create database → "Production mode"
        → sana en yakın bölgeyi seç → Enable.
     4) Firestore açıldıktan sonra "Rules" sekmesine git, mevcut kuralları
        SİL ve aşağıdakini yapıştırıp Publish'e bas (her kullanıcı SADECE
        kendi verisini okuyup yazabilsin diye — bu adım kritik, atlama):

           rules_version = '2';
           service cloud.firestore {
             match /databases/{database}/documents {
               match /users/{uid} {
                 allow read, write: if request.auth != null && request.auth.uid == uid;
               }
             }
           }

     5) Proje ana sayfasına dön (⚙ Project settings) → "Your apps" →
        "</>" (Web) ikonuna tıkla → bir takma ad gir (ör. "oplab-web") →
        "Register app" → sana bir "firebaseConfig" nesnesi gösterilecek —
        içindeki 6 değeri aşağıya, ilgili alanlara aynen kopyala.

   Bu değerler (apiKey dahil) GİZLİ DEĞİLDİR — Firebase'in herkese açık
   web yapılandırmasıdır, kaynak kodda durması normaldir (gerçek güvenlik
   3. adımdaki Firestore kurallarında sağlanır). Yine de karışmasın diye:
   buraya ASLA bir "service account" / "private key" JSON'u YAPIŞTIRMA —
   o bambaşka bir şeydir ve sadece sunucu tarafında kullanılır, tarayıcıya
   hiç gitmemesi gerekir.

   Bu dosya hâlâ aşağıdaki YER TUTUCU değerlerle duruyorsa, giriş ekranı
   (oplabAuth.js) bunu otomatik algılar ve sessizce "misafir modu"na
   düşer — site bozulmaz, sadece e-posta ile giriş/senkronizasyon henüz
   aktif olmaz.
   ════════════════════════════════════════════════════════════════════ */
window.OPLAB_FIREBASE_CONFIG = {
    apiKey: 'BURAYA_YAPISTIR',
    authDomain: 'BURAYA_YAPISTIR.firebaseapp.com',
    projectId: 'BURAYA_YAPISTIR',
    storageBucket: 'BURAYA_YAPISTIR.appspot.com',
    messagingSenderId: 'BURAYA_YAPISTIR',
    appId: 'BURAYA_YAPISTIR'
};
