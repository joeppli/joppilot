# Jöppli - Ürün Gereksinimleri (Product Requirements)

## A. Fonksiyonel Gereksinimler

### FR-1 · Resident App 

| ID | Gereksinim |
|---|---|
| FR-1.1 | Kullanıcı, kapıdan geri dönüşüm alımı talep edebilmelidir. |
| FR-1.2 | Kullanıcı yük boyutu seçebilmelidir: Small (1–2 standart torba), Medium (3–5), Big (6–10), Mega (tam yük / araç kapasitesi). |
| FR-1.3 | Uygulama, atanan aracın canlı ETA'sını ve talep edilen yük bilgisini göstermelidir. |
| FR-1.4 | Uygulama, geri dönüşüme ne kadar katkıda bulunulduğunu göstermelidir.  |
| FR-1.5 | Talep durumu değişikliklerinde (atandı, yolda, tamamlandı) kullanıcı bilgilendirilmelidir. |

### FR-2 · Otonom Filo (Araç + Sevkiyat)

| ID | Gereksinim |
|---|---|
| FR-2.1 | Araçlar talep üzerine (on-demand) sevk edilmelidir. |
| FR-2.2 | Rotalar gerçek zamanlı optimize edilmelidir. |
| FR-2.3 | Araç, 6 ayrı atık bölmesine sahip olmalıdır: cam , kağıt, metal/alüminyum, plastik, e-atık, diğer. |
| FR-2.4 | Araç, atık türü/doluluk tespiti için sensörlerle donatılmalıdır. |
| FR-2.5 | Araç tamamen elektrikli olmalı ve sürücüsüz (Swiss OAD kapsamında) çalışabilmelidir. |
| FR-2.6 | Araç üzerinde, atığın doğru bölmeye bırakılmasını yönlendiren bir teslim arayüzü (etiketli bölme kapakları) bulunmalıdır. |
| FR-2.7 | Araç, uzaktan müdahale için tele-operasyon bağlantısını desteklemelidir. |

### FR-3 · Joppilot

| ID | Gereksinim |
|---|---|
| FR-3.1 | Her alım; tür, ağırlık ve konum bazında otomatik loglanmalıdır. |
| FR-3.2 | Konsol; araç sayısı, alım sayısı ve aktif tele-operasyon sayısını içeren canlı filo haritası sunmalıdır. |
| FR-3.3 | Konsol, operasyon senaryoları için simülasyon ortamı sağlamalıdır. |
| FR-3.4 | Konsol, tele-operasyon ve human-in-the-loop müdahalesini desteklemelidir. |
| FR-3.5 | Veriler hane, sokak ve mahalle düzeyinde raporlanabilmelidir (belediyenin bugün sahip olmadığı görünürlük). |
| FR-3.6 | Konsol; yerler/geofence'ler, depolar, şarj ve enerji, araç bakım/denetim kayıtları ve envanter yönetimini içermelidir. |

### FR-4 · İş Modeli Desteği

| ID | Gereksinim |
|---|---|
| FR-4.1 | Sistem, B2G bölge başına aylık RaaS sözleşmelerini destekleyecek şekilde bölge/district bazlı operasyon ve raporlama sunmalıdır. |
| FR-4.2 | Sistem, B2B markalı filoları (ortaklarla ortak operasyon) ve ek atık dikeylerini (tehlikeli atık, e-atık) destekleyecek esneklikte olmalıdır. |
| FR-4.3 | Rol ayrımı: teknoloji operasyonu Jöppli'de, vatandaş ilişkisi ve yönetim belediyede kalacak şekilde yetkilendirme yapılmalıdır. |

---

## B. Fonksiyonel Olmayan Gereksinimler

### NFR-1 · Güvenlik (Safety)
- Sürücüsüz operasyon, İsviçre Otomatik Sürüş Yönetmeliği (OAD, 2025) gerekliliklerine tam uyumlu olmalıdır.
- Otonomi belirsizlik durumlarında human-in-the-loop / tele-operasyon devreye girebilmeli; güvenli durma (fail-safe) davranışı tanımlı olmalıdır.
- Araç, yaya yoğun dar kentsel sokaklarda (operasyonel alan: şehir içi, dar ODD) güvenle çalışacak şekilde tasarlanmalıdır.

### NFR-2 · Performans
- Rota optimizasyonu gerçek zamanlı çalışmalıdır; ETA bilgisi kullanıcıya canlı yansıtılmalıdır. *(Gecikme/doğruluk hedefleri: doğrulanacak)*
- Konsol, filo durumunu canlı ("LIVE") olarak göstermelidir.

### NFR-3 · Ölçeklenebilirlik
- Birim kapsama: 1 araç = 0.5 km² kentsel bölge.
- Sistem; tek pilot şehirden (Zürich 2027) → 3–5 şehre (5–15 araç) → AB ölçeğine (2030+, 50+ araç) personel artışı gerektirmeden ölçeklenebilmelidir.
- Çoklu şehir / çoklu kiracı (multi-tenant) mimari desteklenmelidir.

### NFR-4 · Güvenilirlik ve Erişilebilirlik (Availability)
- Filo ve konsol hizmetleri için yüksek erişilebilirlik hedeflenmelidir.
- Bağlantı kesintisinde araç güvenli moda geçmeli; loglar bağlantı geri geldiğinde senkronize edilmelidir.

### NFR-5 · Bilgi Güvenliği ve Gizlilik
- Hane düzeyinde toplanan veriler İsviçre nDSG ile, AB fazında GDPR ile uyumlu işlenmelidir.
- Belediyeye sunulan raporlarda kişisel veriler amaca uygun şekilde toplulaştırılmalı/anonimleştirilmelidir.
- Tele-operasyon ve araç-bulut iletişimi uçtan uca şifrelenmelidir.

### NFR-6 · Kullanılabilirlik ve Erişilebilirlik (Accessibility)
- Hedef kitle yaşlı, arabasız ve zamanı kısıtlı haneleri içerdiğinden uygulama akışı en fazla iki dokunuşla tamamlanabilmeli, büyük yazı/yüksek kontrast gibi erişilebilirlik standartlarını karşılamalıdır.
- Çok dilli destek: en az DE; hedef pazara göre FR/IT/EN.

### NFR-7 · Birlikte Çalışabilirlik (Interoperability)
- Sistem, ERZ'nin mevcut filo operasyonuna ek personel gerektirmeden entegre olabilmelidir ("slots into ERZ's existing fleet").
- Belediye sistemlerine veri aktarımı için dışa aktarım/raporlama arayüzleri sunulmalıdır.

### NFR-8 · Sürdürülebilirlik ve Fiziksel Kısıtlar
- Araçlar %100 elektrikli olmalı; şarj/enerji yönetimi konsoldan izlenebilmelidir.
- Araç genişliği Microlino'dan dar olmalıdır (dar sokak erişimi için tasarım kısıtı).
- Sabit toplama altyapısı kurulumu veya bakımı gerektirmemelidir.

### NFR-9 · Sürdürülebilirlik (Bakım) ve İzlenebilirlik
- Araç denetim (inspections), bakım ve parça envanteri konsol üzerinden yönetilebilmelidir.
- Tüm operasyonel olaylar denetlenebilir şekilde loglanmalıdır.

---
*"Doğrulanacak" notları, kaynak materyalde sayısal hedef bulunmayan kalite kriterlerini işaretler.*
