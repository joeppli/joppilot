# Joppilot - Yazılım Mimarisi

**Kapsam:** Joppilot - Filo Yönetimi & Uzaktan Kontrol/Denetim Platformu

## İçindekiler

1. [Amaç & Mimari Sürücüler](#1-amaç--mimari-sürücüler)
2. [C4 Seviye 1 — Sistem Bağlamı (Context)](#2-c4-seviye-1--sistem-bağlamı-context)
3. [C4 Seviye 2 — Konteyner Diyagramı (Container)](#3-c4-seviye-2--konteyner-diyagramı-container)
4. [Çekirdek Veri Akışları](#4-çekirdek-veri-akışları)
5. [Bölge Tabanlı Yetkilendirme Mimarisi](#5-bölge-tabanlı-yetkilendirme-mimarisi)
6. [Teknoloji Yığını](#6-teknoloji-yığını)
7. [Üçüncü Parti Entegrasyonlar](#7-üçüncü-parti-entegrasyonlar)
8. [Dağıtım Görünümü (Deployment View)](#8-dağıtım-görünümü-deployment-view)
9. [Ölçeklendirme Mimarisi](#9-ölçeklendirme-mimarisi)
10. [Kesişen İlgiler (Cross-Cutting Concerns)](#10-kesişen-ilgiler-cross-cutting-concerns)
11. [Açık Mimari Kararlar](#11-açık-mimari-kararlar)
12. [Referans Dokümanlar](#12-referans-dokümanlar)

## 1. Amaç & Mimari Sürücüler

### 1.1 Amaç

Joppilot, otonom geri dönüşüm araçlarından (Jöppli) oluşan bir filonun **uzaktan denetim, kontrol ve yönetim** platformudur. Platform şunları sağlar:

- Araçların gerçek zamanlı izlenmesi ve uzaktan denetimi/kontrolü
- Filo operasyonlarının yönetimi (rota, görev, depo, bakım, enerji)
- Hane düzeyinde geri dönüşüm verisi toplama ve belediyeye raporlama
- OAD (İsviçre Otonom Sürüş Yönetmeliği) uyumlu operasyon

### 1.2 Mimari Sürücüler (Architectural Drivers)

Aşağıdaki sürücüler mimari kararları doğrudan şekillendirmektedir. Her sürücü, ilgili kısıt referansıyla birlikte verilmiştir.

| # | Sürücü | Mimari Etki | Kısıt Ref. |
|---|---|---|---|
| **AD-1** | **Gerçek Zaman (Real-Time)** | Telemetri, video, komut ve E-STOP kanalları farklı gecikme/güvenilirlik garantilerine sahip olmalı. Komut yolu video yolundan bağımsız çalışabilmeli. Rota optimizasyonu anlık; ETA kullanıcıya canlı yansımalı. | RTP-01…08 |
| **AD-2** | **Güvenli Durdurma (Failsafe)** | Bağlantı koptuğunda araç **cloud'a bağımlı olmadan** güvenli moda geçmeli. Bu davranış araç üzerinde yerel/çevrimdışı mekanizmayla garanti altında. Kilitli durdurma, yalnızca yetkili açık eylemle çözülebilir. | RES-01…06 |
| **AD-3** | **Güvenlik (Security)** | Uçtan uca şifreleme + karşılıklı doğrulama; MFA; tek operatör kilidi; değiştirilemez denetim günlüğü (WORM); yetki iptalinde anında bağlantı kesme. Komut zarfı: kimlik + token + TTL + imza. | SEC-01…10 |
| **AD-4** | **Dayanıklılık (Resilience)** | Çok taşıyıcılı hücresel bağlantı; kademeli düşüş (graceful degradation); çevrimdışı log tamponu + kayıpsız senkronizasyon; E-STOP'un 2 bağımsız kanaldan gönderimi. | RES-01…06, RTP-08 |
| **AD-5** | **Yasal Uyumluluk (Regulatory)** | Bölge tabanlı mod yönetimi (kanton izinli rota dışında otonom sürüş yok); operatör İsviçre'de olmalı; kalkış öncesi kontrol zorunlu; olay verisi zaman-senkron, eksiksiz, kurcalamaya dayanıklı. | LEG-01…07 |
| **AD-6** | **Veri Koruma (Privacy)** | nDSG + GDPR hazırlık; veri minimizasyonu; video isteğe bağlı (privacy-by-design); yüz/plaka anonimleştirme; veri sahibi hakları iş akışları. | DAT-01…10 |
| **AD-7** | **Ölçek** | Mevcut: ~10 araç, 5+ kamera/araç. Tasarım bu ölçeğe boyutlandırılır; ancak kritik teknoloji seçimleri dikey ölçeklendirmeyi engellememeli. Çok şehir/çok kiracı (multi-tenant) desteği. | OPS-01…04, NFR-3 |

## 2. C4 Seviye 1 — Sistem Bağlamı (Context)

Joppilot'un dış aktörler ve sistemlerle ilişkisini gösteren bağlam diyagramı:

```
                          ┌─────────────────┐
                          │    Kantonlar /   │
                          │    Yetkililer    │
                          │  (Rota onayları, │
                          │  test izinleri)  │
                          └────────┬────────┘
                                   │ bölge/izin yapılandırması
                                   ▼
┌──────────────┐           ┌──────────────────────────┐          ┌──────────────────┐
│  Operatör /  │  denetim  │                          │  komut/  │                  │
│  Uzaktan     │──kontrol──│                          │──teleme──│   Jöppli Araç    │
│  Sürücü      │  video    │                          │  tri/    │   (VEA + ADS)    │
│              │◄──akış────│                          │◄─video───│                  │
└──────────────┘           │                          │          └──────────────────┘
                           │       JOPPILOT           │
┌──────────────┐           │                          │          ┌──────────────────┐
│  Süper Admin │──yönetim──│   Filo Yönetimi &        │──hücre── │  Hücresel        │
│              │  /yapılan.│   Uzaktan Kontrol        │  sel     │  Taşıyıcılar     │
│              │           │   Platformu              │  bağ.    │  (çok taşıyıcılı)│
└──────────────┘           │                          │          └──────────────────┘
                           │                          │
┌──────────────┐           │                          │          ┌──────────────────┐
│  Sakin       │  toplama  │                          │  harita  │  Harita & Rota   │
│  Uygulaması  │──talep────│                          │──/rota───│  Servisi         │
│  (Jöppli App)│◄─ETA────  │                          │  verisi  │  (dış sağlayıcı) │
└──────────────┘           │                          │          └──────────────────┘
                           │                          │
                           │                          │          ┌──────────────────┐
                           │                          │  kimlik  │  Kimlik          │
                           │                          │──doğru── │  Sağlayıcı       │
                           │                          │  lama    │  (IdP / MFA)     │
                           └──────────────────────────┘          └──────────────────┘
```

### 2.1 Aktörler

| Aktör | Açıklama | Etkileşim |
|---|---|---|
| **Operatör (Remote Operator)** | Aracı gerçek zamanlı denetleyen/kontrol eden kişi. İsviçre'de fiziksel olarak bulunmalı (LEG-02). | Video izleme, komut gönderme, manevra onayı, E-STOP, kalkış öncesi kontrol |
| **Uzaktan Sürücü (Remote Driver)** | Mode 2'de (depo/özel alan/izinli test bölgesi) aracı joystick/gamepad ile doğrudan süren kişi. | Direksiyon/gaz/fren girdileri, düşük gecikmeli kontrol |
| **Süper Admin** | Sistem yapılandırması, bölge/geofence yönetimi, operatör yetkilendirme, filo yönetimi. | Yapılandırma, kullanıcı/rol yönetimi, bölge tanımlama |
| **Sakin Uygulaması (Jöppli App)** | Hane sakininin kapıya toplama talebi gönderdiği mobil uygulama. | Toplama talebi, yük boyutu seçimi, canlı ETA, etki takibi |
| **Belediye Konsolu** | Belediyelerin geri dönüşüm verilerini ve raporları gördüğü arayüz. Mevcut aşamada birincil kullanıcı değil (SCP-04). | Raporlama (hane/sokak/mahalle), toplanmış/anonimleştirilmiş veri görüntüleme |
| **Yetkililer (Kantonlar)** | Rota onayı, ODD koşulları, test izinleri veren düzenleyici otorite. | Bölge/izin yapılandırması (dolaylı — yapılandırma olarak sisteme girer) |

### 2.2 Dış Sistemler

| Dış Sistem | Etkileşim | Not |
|---|---|---|
| **Otonom Sürüş Yazılımı (ADS)** | B-Sınırı üzerinden: manevra teklifleri, otonom sürüş etkinleştirme/devre dışı bırakma, durum. ADS kapsam dışıdır (SCP-03); Joppilot sürüş kararı üretmez. | Arayüz kontratı ortak tasarlanır |
| **Hücresel Taşıyıcılar** | Araç ↔ cloud bağlantısı. Çok taşıyıcılı yedeklilik (RES-05). Tünel/vadi kör noktaları planlanmış. | Tekli taşıyıcı çökmesi operasyonları kesmemeli |
| **Harita & Rota Servisi** | Rota hesaplama, harita verisi, geocoding, ETA tahmini için dış sağlayıcı. | Rota optimizasyonu kanton onaylı sınırlarla kısıtlı (RTP-05) |
| **Kimlik Sağlayıcı (IdP)** | Operatör/admin kimlik doğrulama, MFA. | MFA zorunlu (SEC-03); VPN/konum kısıtı (SEC-07) |

> Sınır ve kanal detayları → [joppilot_interface_contract.md](file:///home/leodrive/project/joppilot/.claude/joppilot_interface_contract.md)

---

## 3. C4 Seviye 2 — Konteyner Diyagramı (Container)

Joppilot'un iç yapısını gösteren konteyner diyagramı üç dağıtım alanına ayrılmıştır: **Bulut Servisleri**, **Kenar (Araç Üzeri)** ve **İstemciler**.

```
┌─ İSTEMCİLER ───────────────────────────────────────────────────────────────────┐
│                                                                                │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐  ┌────────────────┐    │
│  │ Operatör      │  │ Yönetim       │  │ Sakin        │  │ Belediye       │    │
│  │ Konsolu       │  │ Paneli        │  │ Uygulaması   │  │ Konsolu        │    │
│  │ [Web SPA]     │  │ [Web SPA]     │  │ [Mobil App]  │  │ [Web SPA]      │    │
│  │               │  │               │  │              │  │ (ileride)      │    │
│  │ • Canlı harita│  │ • Bölge/geo   │  │ • Toplama    │  │ • Raporlar     │    │
│  │ • Video akışı │  │   fence yön.  │  │   talebi     │  │ • Toplanmış    │    │
│  │ • Komut gön.  │  │ • Filo yön.   │  │ • ETA        │  │   veri         │    │
│  │ • Manevra     │  │ • Kullanıcı/  │  │ • Etki       │  │                │    │
│  │   onay kartı  │  │   rol yön.    │  │   takibi     │  │                │    │
│  │ • E-STOP      │  │ • Bakım/enerji│  │              │  │                │    │
│  │ • Kalkış önc. │  │ • Simülasyon  │  │              │  │                │    │
│  │   kontrol     │  │               │  │              │  │                │    │
│  └───────┬───────┘  └───────┬───────┘  └──────┬───────┘  └────────┬───────┘    │
└──────────┼──────────────────┼─────────────────┼───────────────────┼────────────┘
           │                  │                 │                   │
           └──────────────────┴────────┬────────┴───────────────────┘
                                       │ HTTPS / WSS
                                       ▼
┌─ BULUT SERVİSLERİ (AWS) ──────────────────────────────────────────────────────┐
│                                                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐     │
│  │                      API Gateway + WAF                                 │     │
│  └────────────────────────────────────────────────────┬───────────────────┘     │
│                                                       │                        │
│  ┌─ Kimlik & Erişim ─────────────────────────────────────────────────────┐     │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │     │
│  │  │ RBAC / IAM       │  │ Oturum & Kilit   │  │ Coğrafi Erişim   │     │     │
│  │  │ Servisi          │  │ Yöneticisi       │  │ Kontrolü         │     │     │
│  │  │                  │  │ (Session/Lock)   │  │ (VPN Kısıtı)     │     │     │
│  │  │ • Rol tabanlı    │  │                  │  │                  │     │     │
│  │  │   erişim         │  │ • Tek operatör   │  │ • Operatörün     │     │     │
│  │  │ • MFA zorunlu    │  │   kilidi         │  │   İsviçre'de     │     │     │
│  │  │ • En az yetki    │  │ • Token yönetimi │  │   olma zorunl.   │     │     │
│  │  │ • Anında iptal   │  │ • Devir kontrolü │  │                  │     │     │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘     │     │
│  └───────────────────────────────────────────────────────────────────────┘     │
│                                                                                │
│  ┌─ Çekirdek Servisler ──────────────────────────────────────────────────┐     │
│  │                                                                       │     │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │     │
│  │  │ Komut Servisi    │  │ E-STOP Servisi   │  │ Telemetri        │     │     │
│  │  │                  │  │                  │  │ Ingest Servisi   │     │     │
│  │  │ • Zarf (envelope)│  │ • 2 bağımsız     │  │                  │     │     │
│  │  │   oluşturma      │  │   kanaldan eş    │  │ • Sürekli gerçek │     │     │
│  │  │ • Kuyruklama     │  │   zamanlı gön.   │  │   zamanlı alım   │     │     │
│  │  │ • ACK/NACK takip │  │ • Kuyruksuz      │  │ • Ayrıştırma &   │     │     │
│  │  │ • TTL yönetimi   │  │ • En yüksek önc. │  │   dağıtım        │     │     │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘     │     │
│  │                                                                       │     │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │     │
│  │  │ Video Gateway    │  │ Filo & Görev     │  │ Rota Optimizas.  │     │     │
│  │  │                  │  │ Servisi          │  │ Servisi          │     │     │
│  │  │ • İsteğe bağlı   │  │                  │  │                  │     │     │
│  │  │   akış başlatma   │  │ • Araç kayıt &   │  │ • Gerçek zamanlı │     │     │
│  │  │ • 5+ kamera/araç │  │   durum yönetimi │  │   optimizasyon   │     │     │
│  │  │ • Çift yönlü ses │  │ • Görev atama    │  │ • Kanton onaylı  │     │     │
│  │  │ • Düşük gecikme  │  │ • Kalkış öncesi  │  │   sınır kısıtı   │     │     │
│  │  │   (< ~500 ms)    │  │   kontrol iş ak. │  │   (RTP-04∩LEG-01)│     │     │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘     │     │
│  │                                                                       │     │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │     │
│  │  │ Manevra Teklif   │  │ Bölge / Geofence │  │ Geri Dönüşüm    │     │     │
│  │  │ Servisi          │  │ Servisi          │  │ Veri Servisi     │     │     │
│  │  │                  │  │                  │  │                  │     │     │
│  │  │ • ADS teklifini  │  │ • Kanton rotaları│  │ • Tür/ağırlık/   │     │     │
│  │  │   operatöre sun  │  │ • Depo/özel alan │  │   konum loglama  │     │     │
│  │  │ • Onay/ret/alter.│  │ • Test izin bölg.│  │ • Hane/sokak/    │     │     │
│  │  │ • Zaman aşımında │  │ • Mode 1/2 yapıl.│  │   mahalle rapor  │     │     │
│  │  │   güvenli vars.  │  │                  │  │ • Anonimleştirme │     │     │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘     │     │
│  │                                                                       │     │
│  │  ┌──────────────────┐  ┌──────────────────┐                           │     │
│  │  │ OTA Güncelleme   │  │ Log Senkronizas. │                           │     │
│  │  │ Servisi          │  │ Servisi          │                           │     │
│  │  │                  │  │                  │                           │     │
│  │  │ • Staged rollout │  │ • Çevrimdışı     │                           │     │
│  │  │ • Rollback       │  │   birikmiş kayıt │                           │     │
│  │  │ • Aktif oturumu  │  │   alımı          │                           │     │
│  │  │   kesemez        │  │ • Kayıpsız akt.  │                           │     │
│  │  └──────────────────┘  └──────────────────┘                           │     │
│  └───────────────────────────────────────────────────────────────────────┘     │
│                                                                                │
│  ┌─ Denetim & Kayıt ────────────────────────────────────────────────────┐     │
│  │  ┌──────────────────┐  ┌──────────────────┐                           │     │
│  │  │ EDR / Denetim    │  │ Olay Kaydı       │                           │     │
│  │  │ Günlüğü (Audit)  │  │ Deposu           │                           │     │
│  │  │                  │  │                  │                           │     │
│  │  │ • WORM           │  │ • Manevra teklif-│                           │     │
│  │  │ • Korelasyon ID  │  │   karar-sonuç    │                           │     │
│  │  │ • Kim/ne zaman/  │  │ • Güvenli dur.   │                           │     │
│  │  │   hangi araç/    │  │   olayları       │                           │     │
│  │  │   hangi komut    │  │ • Kalkış öncesi  │                           │     │
│  │  │ • Kanıt zinciri  │  │   kontrol loglar │                           │     │
│  │  └──────────────────┘  └──────────────────┘                           │     │
│  └───────────────────────────────────────────────────────────────────────┘     │
│                                                                                │
│  ┌─ Veri Depoları ──────────────────────────────────────────────────────┐     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │     │
│  │  │ Operasyonel  │  │ Zaman Serisi │  │ Video/Ses    │  │ Belediye │ │     │
│  │  │ Veritabanı   │  │ Deposu       │  │ Arşivi       │  │ Rapor    │ │     │
│  │  │ (ilişkisel)  │  │ (telemetri)  │  │ (anonimleş.) │  │ Deposu   │ │     │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘ │     │
│  └───────────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────────┘
                         │
                         │ A-Sınırı (şifreli, mTLS)
                         │
┌─ KENAR — ARAÇ ÜZERİ (VEA) ───────────────────────────────────────────────────┐
│                                                                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │ Komut Doğrulayıcı│  │ Geofence         │  │ Deadman /        │              │
│  │ & Yetki Gate     │  │ Uygulayıcı       │  │ Güvenli Mod      │              │
│  │                  │  │                  │  │ Yöneticisi       │              │
│  │ • Token doğrul.  │  │ • Yerel bölge    │  │                  │              │
│  │ • Bölge/mod      │  │   bilgisiyle     │  │ • Bağlantı-      │              │
│  │   kontrolü       │  │   konum kontrol  │  │   bağımsız yerel │              │
│  │ • TTL kontrolü   │  │ • Mode 2 reddi   │  │   mekanizma      │              │
│  │ • İdempotans     │  │   (kamusal rota)  │  │ • Heartbeat      │              │
│  │   (komut ID)     │  │ • İhlalde güvenli│  │   izleme         │              │
│  │ • Eski token     │  │   mod tetikleme  │  │ • Video donma/   │              │
│  │   reddi          │  │                  │  │   gecikme algıl. │              │
│  └──────────────────┘  └──────────────────┘  │ • Kademeli yanıt │              │
│                                               │ • Kilitli duruş  │              │
│  ┌──────────────────┐  ┌──────────────────┐  └──────────────────┘              │
│  │ Telemetri & Video│  │ Çevrimdışı Log   │                                    │
│  │ Yayıncıları      │  │ Tamponu          │  ┌──────────────────┐              │
│  │                  │  │                  │  │ Öz-Tanı          │              │
│  │ • 5+ kamera akışı│  │ • Bağlantı kaybı│  │ (Self-Diagnostics)│              │
│  │ • Sensör verisi  │  │   sırasında      │  │                  │              │
│  │ • Çift yönlü ses │  │   birikim        │  │ • Fren/direks./  │              │
│  │ • Bağlantı       │  │ • Kayıpsız       │  │   lastik/ışık    │              │
│  │   kalitesi       │  │   senkronizasyon │  │ • Sensör/bilg.   │              │
│  │   metrikleri     │  │                  │  │   sağlığı        │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
│                                                                                │
│  ┌──────────────────┐                                                          │
│  │ B-Sınırı         │                                                          │
│  │ Adaptörü         │ ◄── ADS ile ortak tasarlanan arayüz                      │
│  │                  │                                                          │
│  │ • Manevra teklif │     ┌──────────────────────────────────────────┐          │
│  │   alımı          │────►│          ADS (Otonom Sürüş)              │          │
│  │ • Otonom etkin.   │     │          — Kapsam Dışı (SCP-03) —       │          │
│  │   /devre dışı     │◄────│                                          │          │
│  │ • Durum alımı    │     └──────────────────────────────────────────┘          │
│  └──────────────────┘                                                          │
│                                                                                │
│  ┌──────────────────┐  ┌──────────────────┐                                    │
│  │ Güvenli Anahtar  │  │ Çok Taşıyıcılı  │                                    │
│  │ Deposu (HSM/TPM) │  │ Hücresel Modem  │                                    │
│  │ (tamper-evident) │  │ (yedekli)       │                                    │
│  └──────────────────┘  └──────────────────┘                                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Konteyner Özet Tablosu

| Alan | Konteyner | Teknoloji Tipi | Birincil Sorumluluk |
|---|---|---|---|
| **İstemci** | Operatör Konsolu | Web SPA | Gerçek zamanlı denetim/kontrol arayüzü |
| | Yönetim Paneli | Web SPA | Filo, bölge, bakım, enerji yönetimi |
| | Sakin Uygulaması | Mobil App | Toplama talebi, ETA, etki takibi |
| | Belediye Konsolu | Web SPA | Raporlama (ileride) |
| **Bulut** | API Gateway + WAF | API Ağ Geçidi | Tek giriş noktası, rate limiting |
| | RBAC / IAM | Kimlik Servisi | MFA, rol tabanlı erişim, en az yetki |
| | Oturum & Kilit Yöneticisi | Durum Servisi | Tek operatör kilidi, token yönetimi, devir |
| | Komut Servisi | Uygulama Servisi | Komut zarfı oluşturma, kuyruklama, ACK/NACK |
| | E-STOP Servisi | Uygulama Servisi | Çift kanallı acil durdurma gönderimi |
| | Telemetri Ingest | Veri Alım Servisi | Sürekli gerçek zamanlı telemetri alımı |
| | Video Gateway | Medya Servisi | İsteğe bağlı video/ses akışı yönetimi |
| | Filo & Görev Servisi | Uygulama Servisi | Araç yönetimi, görev atama, kalkış öncesi kontrol |
| | Rota Optimizasyon Servisi | Hesaplama Servisi | Gerçek zamanlı rota, kanton sınırı kısıtlı |
| | Manevra Teklif Servisi | Uygulama Servisi | ADS tekliflerinin operatöre sunulması |
| | Bölge / Geofence Servisi | Yapılandırma Servisi | Bölge tipleri, mod izinleri, test izni yönetimi |
| | Geri Dönüşüm Veri Servisi | Veri Servisi | Toplama loglama, raporlama, anonimleştirme |
| | OTA Güncelleme Servisi | Dağıtım Servisi | Staged rollout, rollback |
| | Log Senkronizasyon Servisi | Veri Alım Servisi | Çevrimdışı kayıtların kayıpsız aktarımı |
| | EDR / Denetim Günlüğü | WORM Depo | Değiştirilemez denetim kaydı, kanıt zinciri |
| | Operasyonel DB | İlişkisel DB | Filo, araç, rota, bölge, oturum verileri |
| | Zaman Serisi DB | TSDB | Telemetri verileri |
| | Video/Ses Arşivi | Nesne Deposu | Oturum kayıtları (anonimleştirilmiş) |
| **Kenar** | Komut Doğrulayıcı | Gömülü Yazılım | Token/bölge/TTL/idempotans doğrulaması |
| | Geofence Uygulayıcı | Gömülü Yazılım | Yerel bölge kontrolü, Mode 2 reddi |
| | Deadman / Güvenli Mod Yön. | Gömülü Yazılım | Bağlantı-bağımsız failsafe |
| | Telemetri & Video Yayıncıları | Gömülü Yazılım | Kamera, sensör, ses aktarımı |
| | Çevrimdışı Log Tamponu | Yerel Depo | Bağlantı kaybı sırasında birikim |
| | B-Sınırı Adaptörü | Gömülü Yazılım | ADS ile iletişim arayüzü |
| | Güvenli Anahtar Deposu | HSM/TPM | Kurcalamaya dayanıklı anahtar saklama |

---

## 4. Çekirdek Veri Akışları

### 4.1 Komut Akışı (Cloud → Araç)

```
Operatör                Cloud                                    VEA (Araç)
   │                      │                                         │
   │  1. Komut isteği     │                                         │
   │─────────────────────►│                                         │
   │                      │  2. Yetki kontrolü                      │
   │                      │     (rol + araç + bölge + token)        │
   │                      │  3. Bölge/mod filtresi                  │
   │                      │     (izin verilmeyen komut → ret)       │
   │                      │  4. Zarf oluşturma                      │
   │                      │     (komut_id, oturum_id, hedef_araç,   │
   │                      │      yetki_token, zaman_damgası,        │
   │                      │      TTL, imza)                         │
   │                      │  5. Gönderim                            │
   │                      │─────────────────────────────────────────►│
   │                      │                                         │  6. Doğrulama:
   │                      │                                         │     • Token geçerli mi?
   │                      │                                         │     • Bölge/mod uyumlu mu?
   │                      │                                         │     • TTL aşılmamış mı?
   │                      │                                         │     • Komut ID tekrar mı?
   │                      │                                         │  7. ACK veya NACK
   │                      │◄─────────────────────────────────────────│
   │  8. Sonuç             │                                         │
   │◄─────────────────────│                                         │
```

### 4.2 E-STOP Akışı

```
Operatör                Cloud                                    VEA (Araç)
   │                      │                                         │
   │  E-STOP tetikle      │                                         │
   │─────────────────────►│                                         │
   │                      │── Kanal-1 (birincil taşıyıcı) ────────►│
   │                      │── Kanal-2 (ikincil taşıyıcı) ────────►│  İlk ulaşan
   │                      │                                         │  uygulanır;
   │                      │                                         │  ikincisi
   │                      │                                         │  komut_id ile
   │                      │                                         │  deduplike edilir
   │                      │                                         │
   │                      │           Her iki kanal da başarısız →   │  Yerel deadman
   │                      │           (tam bağlantı kaybı)          │  mekanizması
   │                      │                                         │  güvenli modu
   │                      │                                         │  tetikler
```

> E-STOP hiçbir koşulda kuyruklanmaz. Kilitli "güvenli durdurma" durumunu hiçbir komut — otomatik kurtarma dahil — kendi başına çözemez; yalnızca yetkili açık eylem çözebilir.

### 4.3 Telemetri & Video Akışı (Araç → Cloud)

```
VEA (Araç)                                   Cloud                    Operatör
   │                                            │                        │
   │  Sürekli telemetri akışı                   │                        │
   │  (konum, hız, batarya, DTC, sensör        │                        │
   │   sağlığı, bilgisayar sağlığı,            │                        │
   │   bağlantı kalitesi)                       │                        │
   │───────────────────────────────────────────►│  Telemetri Ingest      │
   │                                            │───ayrıştır/dağıt─────►│  Canlı panel
   │                                            │──►Zaman Serisi DB      │
   │                                            │                        │
   │  Heartbeat (periyodik)                     │                        │
   │───────────────────────────────────────────►│  Canlılık izleme       │
   │                                            │                        │
   │  Video/Ses (isteğe bağlı — on demand)      │                        │
   │  [Operatör oturum açtığında başlar]         │                        │
   │═══════════════════════════════════════════►│  Video Gateway         │
   │◄══════════════════════════════════════════ │  (çift yönlü ses)     │
   │                                            │═══════════════════════►│  Canlı video
```

> Gerçek zamanlı veriler gecikmeli olarak "yakalanmaz". Canlı kontrol sırasında eski veri oynatılmaz; bağlantı bozulursa güvenli mod devreye girer (AD-2).

### 4.4 Manevra Teklif Akışı (Mode 1)

```
ADS               VEA              Cloud              Operatör
 │                  │                │                    │
 │  Teklif oluştur  │                │                    │
 │  (neden, bağlam, │                │                    │
 │   seçenekler,    │                │                    │
 │   zaman penceresi│                │                    │
 │   güvenli vars.) │                │                    │
 │─────────────────►│                │                    │
 │                  │  Teklif ilet   │                    │
 │                  │───────────────►│                    │
 │                  │                │  Kart olarak sun   │
 │                  │                │───────────────────►│
 │                  │                │                    │  Onayla / Reddet /
 │                  │                │                    │  Alternatif seç
 │                  │                │◄───────────────────│
 │                  │  Karar ilet    │                    │
 │                  │◄───────────────│                    │
 │  Kararı uygula   │                │                    │
 │◄─────────────────│                │                    │
 │                  │                │                    │
 │  ─ ─ Zaman aşımı ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
 │  Güvenli varsayılanı otomatik uygula                   │
```

> Joppilot teklifi **değiştirmeden** sunar; sürüş kararı ADS'e aittir. Operatör onay/reti de standart Mode 1 komutu olarak (aynı zarf, token, loglama ile) işlenir.

### 4.5 Güvenli Mod (Failsafe) Akışı

```
VEA (Araç)                                       Cloud
   │                                                │
   │  Tetikleyici algıla:                           │
   │  • Bağlantı kaybı                             │
   │  • Heartbeat kaybı                            │
   │  • Video donması/gecikme                      │
   │  • Geofence ihlali                            │
   │                                                │
   │  Kademeli yanıt:                               │
   │  ┌─────────────────────────────────────────┐   │
   │  │ 1. Hız/kalite düşür                     │   │
   │  │ 2. Kontrolü mümkün olduğunca koru       │   │
   │  │ 3. Gerekirse kontrollü durdurma          │   │
   │  │    (hız adaptif — yavaş araç = daha     │   │
   │  │     fazla süre)                          │   │
   │  └─────────────────────────────────────────┘   │
   │                                                │
   │  Kilitli duruş:                                │
   │  • Araç kendiliğinden hareket etmez            │
   │  • Olay kaydı oluşturulur                      │
   │  • Oturum logu korunur                         │
   │                                                │
   │  ═══ Bağlantı geri gelir ═══                   │
   │                                                │
   │  Çevrimdışı logları kayıpsız aktar             │
   │───────────────────────────────────────────────►│  Log Senkronizasyon
   │                                                │  Servisi
   │  ⚠ Bağlantı geri gelmesi kilitli duruşu       │
   │    çözmez — yetkili açık eylem gerekli          │
```

### 4.6 Log Senkronizasyon Akışı

```
VEA (Araç)                                       Cloud
   │                                                │
   │  ═══ Çevrimdışı dönem ═══                      │
   │  Yerel tampona yaz:                            │
   │  • Telemetri kayıtları                         │
   │  • Komut/yanıt logları                         │
   │  • Güvenli mod olay kayıtları                  │
   │  • Tanı verileri                               │
   │                                                │
   │  ═══ Bağlantı yeniden kurulur ═══              │
   │                                                │
   │  Birikmiş kayıtları kayıpsız aktar             │
   │───────────────────────────────────────────────►│
   │                                                │  Zaman damgası
   │                                                │  doğrulama +
   │                                                │  veri depolarına
   │                                                │  yazma
```

---

## 5. Bölge Tabanlı Yetkilendirme Mimarisi

Operasyon modlarının (Mode 1 / Mode 2) **bölge tipine** göre belirlenmesi ve bu kuralların **iki katmanda** uygulanması, sistemin en kritik mimari kararıdır.

### 5.1 Çift Katmanlı Uygulama

```
  ┌──────────────────────────────────────────────────────┐
  │                   CLOUD (1. Kapı)                     │
  │  Bölge yapılandırmasına göre izin verilmeyen          │
  │  kontrolleri operatöre göstermez; geçersiz            │
  │  komutu araca göndermeden reddeder.                   │
  └──────────────────────────┬───────────────────────────┘
                             │
                             ▼
  ┌──────────────────────────────────────────────────────┐
  │             ARAÇ (2. Kapı — Nihai & Bağlayıcı)       │
  │  Her komutu kendi bölge bilgisiyle yeniden doğrular.  │
  │  Kamusal rotada Mode 2 komutu — cloud ne gönderirse   │
  │  göndersin — reddedilir.                              │
  │  Komutun uygulanması için:                            │
  │    bölge + rol + yetki token  ÜÇÜ birden eşleşmeli   │
  └──────────────────────────────────────────────────────┘
```

### 5.2 Bölge-Mod Matrisi

| Bölge | Mode 1 (Denetim) | Mode 2 (Doğrudan Sürüş) | Tanı Okuma | Tanı Eylemi |
|---|---|---|---|---|
| Kamusal onaylı rota | ✅ | ❌ (araç reddeder) | ✅ | ✅ (kısıtlı)* |
| Kamusal + geçerli test izni | ✅ | ✅ (izinli bölgede) | ✅ | ✅ |
| Depo / özel / test sahası | ✅ | ✅ (yetkili ise) | ✅ | ✅ |
| Onaylı bölge dışı | ❌ → güvenli durdurma | ❌ → güvenli durdurma | ✅ | Sınırlı |

> *Kamusal rotada sensör/bilgisayar yeniden başlatma gibi kesintiye yol açan eylemler güvenli duruma (IDLE / depo / bakım) ertelenir.

### 5.3 Test İstisnası

Kantondan test izni alınmışsa kamusal segmentte de Mode 2 mümkündür. Ancak bu, çalışma zamanında bir kişinin kuralı devre dışı bırakmasıyla değil, **iznin tanımladığı bölge yapılandırmasıyla** gerçekleşir:
- Geçerlilik penceresi, izin verilen modlar ve koşullar (hız sınırı vb.) yapılandırmaya yansır
- Yapılandırma araca dağıtılır ve araç üzerinde uygulanır
- Bölge tipi değişikliği kontrollü ve loglanmış bir işlemdir; hiçbir rol (Süper Admin dahil) izinsiz kamusal rotada Mode 2 oluşturamaz

---

## 6. Teknoloji Yığını

> ⚠️ Aşağıdaki tablo **mimari niyeti** gösterir. Teknoloji seçimlerinin büyük bölümü henüz kesinleşmemiştir; nihai kararlar ADR'lerde belgelenecektir.

### 6.1 Bulut Katmanı

| Katman | İşlev | Aday Teknoloji / Yaklaşım | Mimari Gerekçe |
|---|---|---|---|
| **Altyapı** | Bulut platformu | AWS (zorunlu — PLT-01) | Kısıt. Bölge: İsviçre/AB veri koruma uyumlu. |
| **API Ağ Geçidi** | Tek giriş, rate limiting, WAF | AWS API Gateway / ALB + WAF | Standart AWS desenler |
| **Kimlik/Erişim** | MFA, RBAC | AWS Cognito / Keycloak / harici IdP | MFA zorunlu (SEC-03); VPN kısıtı (SEC-07) |
| **Komut Dağıtımı** | Güvenilir, düşük gecikmeli mesajlaşma | MQTT (IoT Core) / özel WebSocket kanalı | Araç-bulut iletişim standardı; QoS seviyeleri |
| **E-STOP Kanalı** | Çift kanallı acil durdurma | 2 bağımsız taşıyıcı üzerinden eş zamanlı gönderim | SPOF önleme (AD-4) |
| **Telemetri Alım** | Yüksek hacimli sürekli akış | Kinesis Data Streams / Kafka (MSK) | Gerçek zamanlı alım + fan-out |
| **Video/Ses** | Düşük gecikmeli medya akışı | Kinesis Video Streams / WebRTC / özel medya sunucusu | < ~500 ms glass-to-glass hedefi (RTP-06) |
| **Rota Optimizasyon** | Gerçek zamanlı, kısıtlı | Özel algoritma + harita servisi entegrasyonu | Kanton onaylı sınır kısıtı (RTP-05) |
| **İlişkisel DB** | Operasyonel veri | PostgreSQL (RDS/Aurora) | Yaygın, olgun, ölçeklenebilir |
| **Zaman Serisi DB** | Telemetri | Timestream / InfluxDB / TimescaleDB | Telemetri verisinin doğası gereği |
| **WORM Denetim** | Değiştirilemez audit log | S3 Object Lock (WORM) / CloudTrail + özel katman | Yasal zorunluluk (SEC-06, LEG-04/05) |
| **Nesne Deposu** | Video arşiv, log arşiv | S3 | Uygun maliyet, yaşam döngüsü politikaları |
| **OTA Güncelleme** | Staged rollout + rollback | AWS IoT Jobs / özel OTA servisi | STD-02 zorunluluğu |

### 6.2 Kenar (Araç Üzeri) Katmanı

| Bileşen | Aday Teknoloji / Yaklaşım | Mimari Gerekçe |
|---|---|---|
| **İşletim Sistemi** | Linux tabanlı gömülü OS | Gerçek zamanlı gereksinimler, geniş donanım desteği |
| **VEA Uygulama** | Rust / C++ / Go (düşük gecikmeli, güvenilir) | Güvenlik-kritik, gerçek zamanlı komut işleme |
| **Güvenli Anahtar Deposu** | HSM / TPM | Anahtar materyali çıkarılamaz, kurcalama tespiti (SEC-08) |
| **Yerel Depo** | Kalıcı yerel dosya sistemi / SQLite | Çevrimdışı log tamponu, bölge yapılandırması |
| **Bağlantı** | Çok taşıyıcılı hücresel modem | Yedekli bağlantı (RES-05) |
| **B-Sınırı Protokolü** | ROS 2 / gRPC / özel ara yüz | ADS ekibiyle ortak tasarlanacak |

### 6.3 İstemci Katmanı

| Bileşen | Aday Teknoloji / Yaklaşım | Mimari Gerekçe |
|---|---|---|
| **Operatör Konsolu** | React / Vue + WebSocket + WebRTC | SPA; gerçek zamanlı veri + video akışı |
| **Yönetim Paneli** | Aynı SPA framework | Kod paylaşımı, tutarlı UX |
| **Sakin Uygulaması** | React Native / Flutter / Native | Mobil; iki dokunuşta işlem (NFR-6) |
| **Belediye Konsolu** | Web SPA (ileride) | Raporlama odaklı |
| **i18n** | Anahtar tabanlı çeviri (i18next / intl) | de-CH, en; ileride fr-CH, it-CH (LNG-01…04) |
| **Erişilebilirlik** | WCAG 2.1 AA + eCH-0059 | Yasal zorunluluk (ACC-01…06) |

---

## 7. Üçüncü Parti Entegrasyonlar

| Entegrasyon | Amaç | Yön | Kritik Mi? | Not |
|---|---|---|---|---|
| **Hücresel Taşıyıcılar** (Swisscom, Sunrise, Salt vb.) | Araç ↔ cloud bağlantısı | Çift yönlü | Evet | Çok taşıyıcılı yedeklilik (RES-05). Tünel/vadi kör noktaları planlanmış. |
| **Harita & Rota Servisi** (Google Maps, Mapbox, HERE, OpenStreetMap) | Rota hesaplama, geocoding, ETA | Cloud → dış | Evet | Rota optimizasyonu kanton sınırlarıyla kısıtlı (RTP-05). |
| **Kimlik Sağlayıcı (IdP)** (Cognito, Keycloak, Okta, Auth0) | Operatör/admin kimlik doğrulama + MFA | Cloud → dış | Evet | MFA zorunlu (SEC-03). |
| **E-posta / Bildirim Servisi** (SES, SNS, FCM) | Operatör bildirimleri, belediye raporları, sakin bildirimleri | Cloud → dış | Hayır | Durum değişikliği bildirimleri (FR-1.5). |
| **Hava Durumu Servisi** | Operasyonel karar desteği (yol koşulları) | Cloud → dış | Hayır | İsteğe bağlı; rota optimizasyonunu destekleyebilir. |
| **Belediye Veri Sistemleri** | Raporlama, veri aktarımı | Cloud → belediye | Hayır | Veri dışa aktarma/raporlama arayüzleri (NFR-7). Anonimleştirilmiş. |
| **OEM / Araç Üreticisi** | Araç donanım spesifikasyonları, sensör entegrasyonu | B-Sınırı | Evet | B-Sınırı adaptörü aracılığıyla. |

---

## 8. Dağıtım Görünümü (Deployment View)

### 8.1 Genel Dağıtım Topolojisi

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          AWS (EU Bölgesi)                               │
│                                                                         │
│   ┌───────────┐   ┌───────────┐   ┌────────────┐   ┌────────────┐      │
│   │ CloudFront│   │ API GW    │   │ Uygulama   │   │ Video /    │      │
│   │ (CDN)     │   │ + WAF     │   │ Sunucuları │   │ Medya      │      │
│   │           │   │           │   │ (ECS/EKS/  │   │ Sunucuları │      │
│   │ SPA       │   │ HTTPS/WSS │   │  Lambda)   │   │ (KVS/     │      │
│   │ dağıtımı  │   │           │   │            │   │  WebRTC)   │      │
│   └───────────┘   └─────┬─────┘   └─────┬──────┘   └─────┬──────┘      │
│                         │               │                │              │
│                   ┌─────┴───────────────┴────────────────┘              │
│                   │                                                      │
│   ┌───────────┐   │   ┌───────────┐   ┌────────────┐   ┌────────────┐  │
│   │ IoT Core  │   │   │ Kinesis / │   │ RDS/Aurora │   │ S3         │  │
│   │ (MQTT     │   │   │ MSK       │   │ (Postgres) │   │ (WORM +    │  │
│   │  Broker)  │   │   │ (Teleme.  │   │            │   │  Video     │  │
│   │           │   │   │  Ingest)  │   │ Timestream/│   │  Arşiv +   │  │
│   │ Komut/    │   │   │           │   │ TimescaleDB│   │  Log)      │  │
│   │ Heartbeat │   │   │           │   │ (TSDB)     │   │            │  │
│   └─────┬─────┘   │   └───────────┘   └────────────┘   └────────────┘  │
│         │         │                                                      │
│         │    ┌────┴─────┐                                                │
│         │    │ Cognito / │   ┌────────────┐                              │
│         │    │ Keycloak  │   │ IoT Jobs   │                              │
│         │    │ (IdP+MFA) │   │ (OTA)      │                              │
│         │    └──────────┘   └────────────┘                              │
│         │                                                                │
│   Bölge: eu-central-1 (Frankfurt) veya eu-central-2 (Zürich)            │
│   → DAT-08 uyumlu; gelecekte İsviçre bölgesi zorunlu olursa geçiş      │
│     yapılabilir tasarım.                                                 │
└─────────┬───────────────────────────────────────────────────────────────┘
          │
          │  A-Sınırı
          │  mTLS + şifreli
          │  (çok taşıyıcılı hücresel)
          │
┌─────────┴───────────────────────────────────────────────────────────────┐
│                         ARAÇ BİLGİSAYARI                               │
│                                                                         │
│   ┌───────────────────────────────────────────────────────────────┐     │
│   │                          VEA                                  │     │
│   │  Komut Doğrulayıcı │ Geofence Uyg. │ Deadman │ B-Sınırı Ad. │     │
│   │  Telemetri Yayıncı │ Video Yayıncı │ Log Tampon │ Öz-Tanı    │     │
│   └───────────────────────────────────────────────────────────────┘     │
│                                                                         │
│   ┌───────────┐   ┌───────────────────┐   ┌─────────────────────┐      │
│   │ HSM/TPM   │   │ Çok Taşıyıcılı   │   │ Kameralar (5+)      │      │
│   │           │   │ Hücresel Modem    │   │ & Sensörler          │      │
│   └───────────┘   └───────────────────┘   └─────────────────────┘      │
│                                                                         │
│                    ┌──────────────────────────────────┐                  │
│                    │  ADS (Otonom Sürüş — Kapsam Dışı) │                  │
│                    └──────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 AWS Bölge Seçimi Stratejisi

| Senaryo | Tercih Edilen Bölge | Gerekçe |
|---|---|---|
| Başlangıç (yalnızca İsviçre) | `eu-central-1` (Frankfurt) veya `eu-central-2` (Zürich, varsa) | nDSG uyumlu; düşük gecikme |
| AB Genişleme (Faz 3) | Ek bölge(ler) + multi-region | GDPR uyumlu; coğrafi yakınlık |
| İsviçre sınırı zorunlu olursa | İsviçre bölgesine taşınabilir tasarım | DAT-08 esneklik kısıtı |

> Altyapı servis seçimlerinde yaşam döngüsü/uzun ömür değerlendirmesi yapılmalı; kullanımdan kalkma riski olan servislerde ince soyutlama katmanları korunmalıdır (PLT-03).

### 8.3 OTA Güncelleme Stratejisi

- **Aşamalı dağıtım (staged rollout):** Güncellemeler kademeli olarak araç alt kümelerine dağıtılır.
- **Geri alma (rollback):** Başarısız güncelleme durumunda önceki sürüme otomatik/manuel dönüş.
- **Güncelleme kısıtları:**
  - Aktif bir operatör oturumunu sessizce kesemez.
  - Kilitli "güvenli durdurma" durumunu geçersiz kılamaz veya kesintiye uğratamaz.
  - Güncelleme süreci loglanır ve denetlenebilir (STD-02).

---

## 9. Ölçeklendirme Mimarisi

### 9.1 Mevcut Ölçek

| Parametre | Değer | Kısıt Ref. |
|---|---|---|
| Filo büyüklüğü | ~10 araç | OPS-01 |
| Araç başına kamera akışı | ≥ 5 eş zamanlı | RTP-01, OPS-02 |
| Kapsama | 1 araç = 0.5 km² kentsel alan | NFR-3 |
| Eş zamanlı video oturumu | İsteğe bağlı açılır; filo büyüklüğünden bağımsız | OPS-04 |

### 9.2 Ölçeklendirme Yaklaşımı

| Boyut | Strateji |
|---|---|
| **Mevcut odak** | 10 araçlık filo; tasarım ve testler bu ölçeğe göre boyutlandırılır. |
| **Dikey ölçeklendirme** | Birincil hedef değil; ancak kritik teknoloji seçimleri bunu engellememeli (OPS-03). |
| **Çok şehir / çok kiracı** | Mimari, birden fazla şehir ve belediye operasyonunu destekleyecek şekilde tasarlanmalı. Tenant izolasyonu (veri, yapılandırma, raporlama). |
| **Faz 2 (3–5 şehir, 5–15 araç)** | Aynı mimari, yatay ölçeklendirme. |
| **Faz 3 (AB, 50+ araç)** | Multi-region dağıtım, ek veri koruma gereksinimleri (GDPR). |

---

## 10. Kesişen İlgiler (Cross-Cutting Concerns)

### 10.1 Denetim ve İzlenebilirlik (Audit & Traceability)

Tüm kritik eylemler değiştirilemez (WORM) denetim günlüğüne yazılır:

| Ne Loglanır | Neden |
|---|---|
| Kim, ne zaman, hangi araçta, hangi komutu verdi | Kanıt zinciri (LEG-05) |
| Manevra teklif → karar → sonuç zinciri | Sorumluluk takibi |
| Her güvenli durdurma olayı + ilişkili oturum logu | Olay sonrası analiz |
| Kalkış öncesi kontrol sonuçları + operatör onayları | Yasal zorunluluk (LEG-03) |
| Operatör oturum başlatma/kapama, devir, yetki iptali | Erişim denetimi |

Kayıtlar korelasyon ID ile ilişkilendirilir; zaman senkronize, eksiksiz ve kurcalamaya dayanıklıdır (LEG-04).

### 10.2 Çok Dilli Altyapı (i18n)

- Anahtar tabanlı (key-based) çeviri sistemi.
- Başlangıç: `de-CH`, `en`.
- Genişleme: `fr-CH`, `it-CH` eklenebilir yapıda (LNG-03).
- İsviçre yerel formatları: sayı (1'234.56), tarih (dd.mm.yyyy), saat dilimi (Europe/Zurich) — LNG-04.

### 10.3 Erişilebilirlik

- WCAG 2.1 AA temel hedef (ileriye dönük: WCAG 2.2 AA) — ACC-01.
- eCH-0059 İsviçre teknik referansıyla uyumlu.
- Tam klavye işlerliği; özellikle E-STOP butonu büyük, belirgin ve klavye erişilebilir — ACC-04.
- %200'e kadar yakınlama, yüksek kontrast, renk tek başına bilgi taşımaz — ACC-02, ACC-03.

### 10.4 Gizlilik ve Veri Koruma (Privacy by Design)

- Video akışı varsayılan olarak sürekli kayıt yapmaz; isteğe bağlı açılır (maliyet + gizlilik) — RTP-07.
- Üçüncü taraf yüzleri/plakaları olay/hukuki amaç dışında anonimleştirilir — DAT-05.
- Belediye raporlarında kişisel veri varsayılan olarak hane düzeyinde tanımlayıcı içermez — DAT-04.
- Veri minimizasyonu prensibi: yalnızca operasyonel olarak gerekli veri toplanır — DAT-03.
- Saklama süreleri tanımlı ve uygulanabilir; veri sahibi hakları iş akışları mevcut — DAT-06, DAT-07.
- İhlal bildirimi süreci tanımlı — DAT-09.

---

## 11. Açık Mimari Kararlar

### 11.1 Alınmış Kararlar

| # | Karar | Gerekçe | Kısıt Ref. |
|---|---|---|---|
| AK-1 | AWS üzerinde çalışma | Altyapı kısıtı | PLT-01 |
| AK-2 | Çift katmanlı komut doğrulama (cloud + araç) | Bağlantı kopması, gecikme, sahte komut güvenliği | SEC-01, RES-01 |
| AK-3 | E-STOP'un 2 bağımsız kanaldan gönderimi | SPOF önleme; en kritik komut ilk denemede ulaşmalı | RES-05 |
| AK-4 | Video akışının isteğe bağlı olması | Maliyet optimizasyonu + privacy-by-design | RTP-07, DAT-03 |
| AK-5 | Bölge tabanlı mod yönetimi | OAD yasal uyumluluk | LEG-01 |
| AK-6 | Bağlantı-bağımsız yerel failsafe (araç üzeri) | Cloud'a bağımlılık olmadan güvenli mod garantisi | RES-01 |
| AK-7 | WORM denetim günlüğü | Yasal kanıt zinciri zorunluluğu | SEC-06, LEG-04/05 |
| AK-8 | Operatör İsviçre'de olma zorunluluğu (VPN/ağ kısıtı) | Yasal zorunluluk | LEG-02 |
| AK-9 | Tek operatör kilidi (token tabanlı) | Split-brain önleme | SEC-05 |

### 11.2 Henüz Karar Verilmemiş Noktalar

| # | Konu | Karar Verici | Bağımlılık |
|---|---|---|---|
| AP-1 | Komut/E-STOP/video için kesin gecikme eşikleri | Mühendislik ekibi | POC/pilot ile doğrulanacak |
| AP-2 | Olay günlüğünde tam olarak ne saklanır, ne kadar süre tutulur | Gizlilik sorumlusu + hukuk/sigorta + otorite | DAT-06 |
| AP-3 | B-sınırı teklif şeması (neden seti, seçenek semantiği, zamanlama) | Otonom sürüş ekibi | ADS geliştirme takvimi |
| AP-4 | Kanton (GL/ZH/BS) bölge koşulları parametre modeli | Yetkilendirme süreci | Kanton izin süreçleri |
| AP-5 | Heartbeat periyodu ve eşikleri, Mode 2 watchdog zamanlayıcıları | Otonom sürüş ekibi | Pilotta ayarlanacak |
| AP-6 | Mode 2 sürüş girdilerinin araçta nereye düştüğü (düşük seviye kontrole mi, ADS yığını üzerinden mi) | Otonom sürüş ekibi | B-Sınırı tasarımı |
| AP-7 | MQTT vs WebSocket vs özel protokol (komut kanalı) | Mühendislik ekibi | Gecikme/güvenilirlik testleri |
| AP-8 | Video altyapısı (KVS vs WebRTC vs özel medya sunucusu) | Mühendislik ekibi | Gecikme/maliyet analizi |
| AP-9 | İlişkisel DB seçimi (PostgreSQL Aurora vs RDS vs self-managed) | Mühendislik ekibi | Ölçek/maliyet analizi |
| AP-10 | Zaman serisi DB seçimi (Timestream vs TimescaleDB vs InfluxDB) | Mühendislik ekibi | Telemetri hacim analizi |
| AP-11 | VEA uygulama dili (Rust vs C++ vs Go) | Mühendislik ekibi | Performans/güvenlik testleri |
| AP-12 | Frontend framework (React vs Vue vs diğer) | Mühendislik ekibi | Ekip deneyimi |
| AP-13 | Mobil uygulama yaklaşımı (React Native vs Flutter vs Native) | Mühendislik ekibi | Ekip deneyimi |
| AP-14 | Monolit vs mikroservis mimarisi (ilk aşama) | Mühendislik ekibi | Ölçek/ekip büyüklüğü |
| AP-15 | B-Sınırı protokolü (ROS 2 vs gRPC vs özel) | Otonom sürüş ekibi + Joppilot | ADS mimarisi |
| AP-16 | Booking (rezervasyon/kiralama) sistemi — yapılacak mı, nasıl? | Ürün ekibi | SCP-05 (belirsiz) |

> Nihai kararlar ADR'lerde belgelenecektir → [joppilot_architecture_decision_records.md](file:///home/leodrive/project/joppilot/.claude/joppilot_architecture_decision_records.md)

---

## 12. Referans Dokümanlar

Bu doküman yalnızca yazılım mimarisini tanımlar. Aşağıdaki dokümanlar mimarinin dayandığı iş ve teknik bağlamı sağlar:

| Doküman | İçerik |
|---|---|
| [joeppli_project_charter.md](file:///home/leodrive/project/joppilot/.claude/joeppli_project_charter.md) | Proje amacı, kapsamı, paydaşlar, kısıtlar, riskler |
| [joeppli_product_requirements.md](file:///home/leodrive/project/joppilot/.claude/joeppli_product_requirements.md) | Fonksiyonel ve fonksiyonel olmayan gereksinimler |
| [joppilot_constraints.md](file:///home/leodrive/project/joppilot/.claude/joppilot_constraints.md) | Yasal, güvenlik, performans, veri koruma, erişilebilirlik, platform kısıtları |
| [joppilot_interface_contract.md](file:///home/leodrive/project/joppilot/.claude/joppilot_interface_contract.md) | Operasyon modları, sınır tanımları, kanal yapısı, komut detayları |
| [joppilot_architecture_decision_records.md](file:///home/leodrive/project/joppilot/.claude/joppilot_architecture_decision_records.md) | Mimari kararların gerekçeli kaydı |
