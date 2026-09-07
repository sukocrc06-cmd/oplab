/* ════════════════════════════════════════════════════════════════════
   oplab — Appwrite Yapılandırması (Kimlik Doğrulama + Senkronizasyon)
   (7 Eylül 2026 — Firebase → Supabase → Appwrite, üçüncü ve son deneme)

   Firebase'de Google Cloud Console'un kendi tarafında çözülemeyen bir 401
   hatası çıktı (proje/Firestore/Rules oluşturmanın hepsinde). Supabase'de
   ise hesabın zaten 2 ücretsiz proje limitine ulaşmış olması yeni proje
   açılmasını engelledi. Appwrite bu ikisinden de bağımsız, ayrı bir
   servis/hesap — hem kimlik doğrulama hem veritabanı tek yerde.

   Bu iki değer (endpoint ve project ID) GİZLİ DEĞİLDİR — Appwrite'ın
   herkese açık istemci (client-side) yapılandırmasıdır, kaynak kodda
   durması normaldir. Gerçek güvenlik, Appwrite Console'da veritabanı
   koleksiyonuna eklenen izinlerde (permissions) sağlanır — bkz.
   oplab-appwrite-setup.md.

   Bu proje için zaten oluşturulmuş Appwrite projesinin bilgileri (Appwrite
   Console → sağ üstte görünen "Project ID" ve "API Endpoint" değerleri).
   ════════════════════════════════════════════════════════════════════ */
window.OPLAB_APPWRITE_CONFIG = {
    endpoint: 'https://fra.cloud.appwrite.io/v1',
    projectId: '6a9e0d3a00374cda4da3',
    databaseId: 'oplab_db',
    collectionId: 'user_data'
};
