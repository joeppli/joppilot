# Jöppli - Proje Bildirgesi

## 1. Projenin Amacı

Jöppli, geri dönüşüm toplama noktasını hanenin kapısına getiren otonom bir geri dönüşüm lojistiği sistemi kurar. Elektrikli, sürücüsüz mini kamyonlar (Microlino'dan daha dar) talep üzerine kapıya gelir; belediyeler sabit toplama altyapısı kurmadan ve personel eklemeden, hane düzeyinde veriyle desteklenen kapıdan geri dönüşüm hizmeti sunar.

**Vizyon cümlesi:** "The future of recycling is at your door."

## 2. Gerekçe (Problem Tanımı)

Döngüsel ekonominin zayıf halkası, sistemin her hanedeki "tek motive kişiye" dayanmasıdır:

- **Efor:** Sammelstelle'lere (toplama noktaları) ortalama mesafe ~500 m; banliyölerde ve düşük yoğunluklu kantonlarda haftada yalnızca iki gün açıklar. Yaşlılar, arabasızlar ve zamanı kısıtlı haneler sistemin dışında kalıyor.
- **İsraf:** Zürich'te ERZ'nin elle ayrıştırdığı 832 Züri-Säcke torbasının %40'ının aslında geri dönüştürülebilir olduğu görüldü. Kaçak atık ve hatalı ayrıştırma gizli bir vergi maliyeti.
- **Veri yokluğu:** Hane, sokak veya mahalle düzeyinde geri dönüşüm verisi sıfır. ERZ bu bilgiyi öğrenmek için 832 torbayı elle ayrıştırmak zorunda kaldı.

## 3. Kapsam

### Kapsam içi
- **Resident app:** İki dokunuşla kapıdan alım talebi, yük boyutu seçimi, canlı ETA, etki takibi.
- **Otonom filo:** Elektrikli, 6 bölmeli (cam, kağıt, metal, plastik, e-atık, diğer), sensörlü, talep üzerine sevk edilen araçlar; gerçek zamanlı rota optimizasyonu.
- **City console:** Her alımın tür, ağırlık ve konum bazında loglanması; canlı filo haritası; simülasyon; tele-operasyon; human-in-the-loop müdahale.
- Alt-Wiedikon'da simülasyon testleri (devam ediyor) ve 2027 Zürich pilotu (ERZ ile).
- B2G RaaS sözleşmeleri (bölge başına aylık) ve B2B markalı filolar + diğer atık dikeyleri (tehlikeli atık, e-atık).

### Kapsam dışı
- Atık işleme / ayrıştırma tesisleri (yalnızca toplama lojistiği).
- Yeni sabit toplama noktası altyapısı kurulması veya bakımı.
- Vatandaş ilişkisi yönetimi (belediyede kalır; Jöppli teknoloji operasyonunu üstlenir).
- Robotaksi / genel amaçlı otonom araç geliştirme (yalnızca dikey, dar operasyonel alan).

## 4. Hedefler

| Faz | Dönem | Hedef | Finansman |
|---|---|---|---|
| Faz 0 - Simülasyon | 2026 | Alt-Wiedikon'da simülasyon doğrulaması | Mevcut kaynaklar |
| Faz 1 - Pilot | 2027 | Zürich'te ERZ ile pilot operasyon | Pre-Seed CHF 0.8–1M |
| Faz 2 - Çoklu şehir | 2027–2030 | 3–5 İsviçre şehri, 5–15 araç, şirket içi filo yönetimi ve otonomi teknolojisi | Series A CHF 6–8M |
| Faz 3 - AB | 2030+ | AB pazarına giriş, 50+ operasyonel araç, CHF 5–15M ARR | - |
| Exit | 2032–2035 |

**Pazar hedefi:** İsviçre pazarı CHF 1.5B (yılda ~6 milyon ton atık); AB belediye atık ve geri dönüşüm toplama hizmetleri pazarı CHF 30B/yıl. 2030'da 50 araçla CHF 6M ARR ≈ İsviçre pazarının %0.4'ü. Birim ekonomi varsayımı: 1 araç = 0.5 km² kentsel bölge.

## 5. Paydaşlar

| Paydaş | Rol / Beklenti |
|---|---|
| Armağan Arslan (Founder) | Proje sahibi; 10+ yıl otonom araç geliştirme, devreye alma ve test deneyimi |
| ERZ (Entsorgung + Recycling Zürich) | Pilot ortağı; mevcut filoya ek personel olmadan entegrasyon |
| Belediyeler (B2G) | RaaS müşterisi; vatandaş ilişkisini yönetir, hane düzeyinde veri kazanır |
| Hane sakinleri | Son kullanıcı; özellikle yaşlı, arabasız ve zamanı kısıtlı haneler |
| Yatırımcılar | Pre-Seed (CHF 0.8–1M) ve Series A (CHF 6–8M) |
| Düzenleyiciler | OAD (Otomatik Sürüş Yönetmeliği, 2025'ten beri yürürlükte) izinleri; BAFU/FOEN geri dönüşüm hedefleri |
| OEM ortakları | Araç üretimi / tedarik |
| B2B müşteriler | Markalı filolar, tehlikeli atık ve e-atık dikeyleri |
| Döngüsel ekonomi aktörleri | Ağ, tanıtım ve geri bildirim ortakları |

## 6. Kısıtlar

- **Düzenleyici:** İsviçre OAD kapsamında sürücüsüz operasyon izinleri; operasyonel alan (ODD) kısıtları; BAFU hedefleriyle uyum.
- **Teknik:** Araç genişliği Microlino'dan dar olmalı; araç başına ~0.5 km² kapsama; 6 bölmeli iç tasarım; tele-operasyon ve human-in-the-loop kapasitesi şart.
- **Operasyonel:** Yeni sabit altyapı kurulmadan çalışmalı; personel artırmadan (headcount eklemeden) ölçeklenmeli; ERZ'nin mevcut filo operasyonuna entegre olmalı.
- **Finansal:** Faz geçişleri tur finansmanına bağlı (Pre-Seed → Series A).
- **Veri / gizlilik:** Hane düzeyinde veri toplama, İsviçre nDSG (ve AB fazında GDPR) ile uyumlu olmalı.

## 7. Varsayımlar

- OAD kapsamında Zürich pilotu için gerekli izinler 2027'ye kadar alınabilir.
- Belediyeler RaaS modelini (teknoloji Jöppli'de, yönetim belediyede) benimser.
- Hane sakinleri uygulama tabanlı talep modelini kabul eder.
- B2G CHF 3.5–5K/araç/ay aralığının üzerindeki ortalama gelir (≈CHF 10K/araç/ay), B2B primi ve atık dikeyleri karışımıyla savunulabilir. *(Deck'te açık konu olarak işaretli.)*

## 8. Riskler (Özet)

- Düzenleyici izinlerde gecikme veya ODD kısıtlamaları.
- Kamu kabulü ve uygulama benimseme oranının beklenenin altında kalması.
- Birim ekonominin (ARR/araç) hedeflenen karışımla doğrulanamaması.
- Dikey AV pazarında rekabet (paket teslimat / shuttle oyuncularının yatay genişlemesi).

## 9. Başarı Kriterleri

- **Faz 0:** Alt-Wiedikon simülasyonunda operasyonel senaryoların doğrulanması. *(Sayısal kabul kriterleri: doğrulanacak)*
- **Faz 1 (Pilot):** Zürich pilotunun ERZ ile devreye alınması; her alımın tür/ağırlık/konum bazında loglanması; tele-operasyon oranı ve tamamlanan alım hedefleri. *(Hedef KPI'lar: doğrulanacak)*
- **Faz 2:** 3–5 şehir, 5–15 araç; şirket içi otonomi yığınına geçiş.
- **Faz 3 / İş hedefi:** 2030'da 50+ araç, CHF 6M ARR, İsviçre pazar payı %0.4.
- **Çağrı hedefleri (kısa vadeli):** Belediye/OEM/döngüsel ekonomi tanıtımları (network) ve QR anketiyle kullanıcı geri bildirimi.

---
*"Doğrulanacak" olarak işaretli alanlar kaynaklarda sayısal hedef bulunmayan noktaları gösterir.*
