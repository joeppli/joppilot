# Joppilot - Kısıtlar
 
**Kapsam:** Joppilot - Fleet Management & Remote Control System
 
## 0. Belge Hakkında
 
### 0.1 Terimler
- **Jöppli / Joeppli:** Sürücüsüz, otonom geri dönüşüm aracı. (Bu belgenin konusu değil; Joppilot'un yönettiği varlıktır.)
- **Joppilot:** Aracın/filonun uzaktan izlenmesi, denetlenmesi ve kontrolü için kurulacak yazılım platformu. **Bu belgenin konusu budur.**
- **OAD / VAF:** İsviçre Otomatik Sürüş Yönetmeliği (Ordinance on Automated Driving / Verordnung über das automatisierte Fahren).
- **nDSG / revFADP:** Yenilenmiş İsviçre Veri Koruma Kanunu.
- **FDPIC:** İsviçre Federal Veri Koruma ve Şeffaflık Görevlisi (denetim makamı).
- **BehiG / BehiV:** İsviçre Engellilerin Eşitliği Kanunu ve ilgili yönetmeliği.
- **Operatör (Remote Operator):** Aracı uzaktan denetleyen/yöneten kişi.

### 0.2 Zorunluluk Seviyeleri
Her kısıt aşağıdaki seviyelerden biriyle işaretlenir:
- **[Z] Zorunlu**: Uyulması şart. İhlali kabul edilemez.
- **[Ö] Önerilen**: Güçlü beklenti; sapma gerekçelendirilmelidir.
- **[K] Kapsam dışı / mevcut gereksinim değil**: Şu an gerekmiyor; tasarımın bunu imkânsız kılmaması beklenir ama bunun için fazladan iş yapılmamalıdır.

## 1. Kapsam ve Bağlam Kısıtları (KAP)
 
| ID | Seviye | Kısıt |
|---|---|---|
| KAP-01 | [Z] | Joppilot yalnızca **İsviçre** operasyonu için tasarlanır. İlk hedef kantonlar: **Glarus (GL), Zürich (ZH), Basel (BS/BL)**. |
| KAP-02 | [Z] | Joppilot bir **filo yönetimi + uzaktan kontrol/denetim** platformudur. Çekirdek yetenekler: filo izleme, diyagnostik, gerçek zamanlı telemetri/kamera akışı, uzaktan denetim/kontrol, rota optimizasyonu, hane düzeyinde geri dönüşüm verisi toplama ve belediye raporlaması. |
| KAP-03 | [Z] | Aracın **otonomi/sürüş yazılımı Joppilot kapsamı dışındadır.** Joppilot bu yığınla yalnızca tanımlı bir arayüz üzerinden haberleşir; sürüş kararlarını üretmez. |
| KAP-04 | [Z] | Filo operatörü, geliştiriciler ve Joeppli mühendisleri sistemin birincil kullanıcılarıdır. Arayüz ve raporlar bu kitleye göre tasarlanır. (Not: Belediyeler şu an birincil kullanıcı değildir; ilerleyen aşamalarda sürece dahil olabilirler.) |
| KAP-05 | [K] | **Booking (rezervasyon/kiralama) sistemi, planlanan ancak gerçekleşeceği kesin olmayan bir bileşendir.** Yapılıp yapılmayacağı projenin ilerleyen aşamalarında netleşecektir; mevcut kapsamda kesin bir gereksinim değildir.|

## 2. Yasal ve Düzenleyici Kısıtlar (YAS)
 
> İsviçre'de sürücüsüz araçların kamuya açık yolda işletilmesi **OAD/VAF (1 Mart 2025'te yürürlükte)** çerçevesine tabidir. Aşağıdaki kısıtlar bu çerçeveden ve veri koruma mevzuatından türetilmiştir.
 
| ID | Seviye | Kısıt |
|---|---|---|
| YAS-01 | [Z] | Sürücüsüz araç yalnızca **ilgili kantonun onayladığı rotalarda** işletilebilir. Joppilot, aracın **yalnızca onaylı rota/bölge sınırları içinde** otonom hareket etmesini destekleyecek (ve bu sınırların dışında kontrolü teleoperatöre bırakacak) biçimde tasarlanmalıdır. |
| YAS-02 | [Z] | Sürücüsüz araç **gerçek zamanlı olarak denetlenmelidir** ve bu denetimi yapan **operatör fiziksel olarak İsviçre'de bulunmak zorundadır**. Sistem, operatör erişimini İsviçre'deki kontrol merkezi/ağı ile sınırlandırabilmelidir. |
| YAS-03 | [Z] | Aracın **kalkış öncesi kontrolü (pre-departure check)** yasal olarak zorunludur (fren, direksiyon, lastik, ışıklar, öz-tanı ile tespit edilen güvenlik hataları vb.). Joppilot bu kontrolün yapılmasını, kaydedilmesini ve operatör tarafından onaylanmasını **dijital bir iş akışı olarak desteklemelidir.** |
| YAS-04 | [Z] | **İlgili sistem/olay verilerinin araçta kaydı yasal olarak zorunludur.** Joppilot, denetim/kontrol oturumlarına ait verilerin (komutlar, telemetri, kararlar, varsa görüntü/ses) **zamanla senkronize, eksiksiz ve değiştirilemez (tamper-evident)** biçimde kaydını ve saklanmasını sağlamalıdır. |
| YAS-05 | [Z] | **Hukuki sorumluluk (civil liability) araç sahibinde kalır** (kusurdan bağımsız, kusursuz sorumluluk). Bu, Joppilot için **denetlenebilirlik ve kanıt zinciri** gereksinimini doğurur: kim, ne zaman, hangi yetkiyle, hangi komutu verdi - hepsi izlenebilir olmalıdır. |
| YAS-06 | [Z] | Geliştirme, yalnızca İsviçre **federal** mevzuatına değil, hedef kantonların (GL/ZH/BS) **kanton düzeyindeki** koşullarına da uymalıdır. Kanton bazlı rota yetkilendirme koşulları konfigüre edilebilir olmalıdır (bkz. Açık Konular). |
| YAS-07 | [Ö] | Sürücüsüz araç bağlamında geçerli güvenlik/siber-güvenlik standartlarına (bkz. STD-01) **uyum kanıtı üretilebilecek** şekilde tasarım yapılmalıdır. |

## 3. Veri ve Gizlilik Kısıtları (VER)
 
| ID | Seviye | Kısıt |
|---|---|---|
| VER-01 | [Z] | **Hane düzeyinde toplanan tüm veriler İsviçre nDSG (revFADP) ile uyumlu** işlenmelidir. |
| VER-02 | [Z] | **AB aşamasına geçildiğinde**, AB'de yerleşik veri öznelerine hizmet verildiği ölçüde **GDPR ek olarak geçerlidir.** Veri modeli ve süreçler bu geçişe hazır olacak şekilde tasarlanmalıdır. |
| VER-03 | [Z] | **Amaca bağlılık (purpose limitation) ve veri minimizasyonu** ilkeleri uygulanmalıdır: yalnızca operasyon için gerekli veri toplanır. |
| VER-04 | [Z] | **Belediyelere sunulan raporlardaki kişisel veriler**, amacına uygun biçimde toplanmış ve **anonimleştirilmiş/takma adlandırılmış** olmalıdır. Belediye raporları varsayılan olarak hane bazında kişi tanımlamamalıdır. |
| VER-05 | [Z] | Kamuya açık alanda kaydedilen **görüntülerde üçüncü kişiler (yüz/plaka)**, olay/hukuki amaç dışındaki kullanımlarda **anonimleştirilmelidir.** |
| VER-06 | [Z] | **Veri saklama süreleri (retention) tanımlı ve uygulanabilir** olmalıdır; silme/saklama, yasal saklama zorunluluklarıyla (örn. olay kayıtları) çelişmeyecek biçimde yönetilmelidir. |
| VER-07 | [Z] | Veri öznesi hakları (erişim, dışa aktarım, silme / "unutulma hakkı") için **işleyen iş akışları** bulunmalıdır. |
| VER-08 | [Z] | **Veri yerleşimi (data residency):** nDSG, bu veriler için İsviçre içinde saklamayı *zorunlu kılmaz*; AB/AEA'ya yeterlilik (adequacy) kapsamında aktarım mümkündür. Ancak sistem, ileride bir sözleşme **İsviçre topraklarında birincil saklama** talep ederse buna **uyarlanabilir** olmalıdır (bu bir tasarım esnekliği kısıtıdır, varsayılan değildir). |
| VER-09 | [Z] | **İhlal bildirimi:** Yüksek riskli veri ihlallerinde FDPIC'e "mümkün olan en kısa sürede" bildirim yapılmasını destekleyen bir süreç/runbook bulunmalıdır. (Not: nDSG'de GDPR'deki gibi sabit 72 saat kuralı yoktur.) |
| VER-10 | [Z] | Gizlilik kararları için **adı geçen bir sorumlu (privacy owner)** atanmalıdır. (Not: nDSG, sorumlu bireylere **kişisel cezai para cezası** öngörebilir; hesap verebilirlik operasyon modeline gömülmelidir.) |

## 4. Güvenlik Kısıtları (GUV)
  
| ID | Seviye | Kısıt |
|---|---|---|
| GUV-01 | [Z] | **Araç ↔ bulut iletişimi uçtan uca şifrelenmelidir** ve **karşılıklı kimlik doğrulamaya (mutual authentication)** dayanmalıdır. Kimliği doğrulanmamış cihaz/aktör sisteme veri yazamaz, komut alamaz. |
| GUV-02 | [Z] | **Hareket hâlindeki (in-transit) ve depodaki (at-rest) tüm veriler şifrelenmelidir.** Şifreleme anahtarları yönetilen ve döndürülebilir olmalıdır. |
| GUV-03 | [Z] | Yetkili olmayan kullanıcı sisteme giriş yapamamalı; roller **birbirinden izole** olmalıdır. Yönetici ve operatör rolleri için **çok faktörlü kimlik doğrulama (MFA) zorunludur.** |
| GUV-04 | [Z] | Erişim **en az ayrıcalık (least privilege)** ilkesine göre verilir. Uzaktan kontrol/denetim yetkisi yalnızca **atanmış araçlar** için geçerlidir. |
| GUV-05 | [Z] | **Aynı araç üzerinde aynı anda yalnızca tek bir operatör** etkin kontrol/denetim yetkisine sahip olabilir. Kontrol devri (handover) kontrollü, kanıtlanabilir ve kayıt altına alınmış olmalıdır; çakışan (split-brain) kontrol kesinlikle engellenmelidir. |
| GUV-06 | [Z] | **Tüm kritik aksiyonlar değiştirilemez (immutable / WORM) denetim kaydına** yazılmalıdır: kim, ne zaman, hangi araçta, hangi komut. Kayıtlar korelasyon kimliğiyle ilişkilendirilebilmelidir. |
| GUV-07 | [Z] | Operatör erişimi **kurumsal ağ / VPN ile sınırlandırılabilmelidir** (bkz. YAS-02). |
| GUV-08 | [Z] | Araç tarafındaki kimlik/anahtar malzemesi **güvenli biçimde saklanmalı** ve cihazdan dışarı çıkarılamamalıdır; kurcalama (tamper) tespit edilebilmelidir. |
| GUV-09 | [Z] | Operatör yetki iptali **anında bağlantı kesintisine** yol açmalıdır. |
| GUV-10 | [Ö] | Sistem, anormal cihaz/iletişim davranışını tespit edebilmeli (filo güvenlik izleme) ve sızma testlerinden (özellikle komut kanalı ve yetki/kilit mantığı) **kritik bulgu olmadan** geçebilmelidir. |

## 5. Gerçek Zamanlılık ve Performans Kısıtları (RTP)
 
| ID | Seviye | Kısıt |
|---|---|---|
| RTP-01 | [Z] | Tek araç için **en az 5 kamera akışı** eşzamanlı aktarılabilmelidir. |
| RTP-02 | [Z] | **Sensör verileri için gerçek zamanlı akış** sürekli olmalıdır. |
| RTP-03 | [Z] | **Araç ve içindeki tüm sensörlerin diyagnostikleri araç bazında** gösterilebilmelidir; bunun için araçtan **gerçek zamanlı diyagnostik akışı** sürmelidir. |
| RTP-04 | [Z] | **Rota optimizasyonu gerçek zamanlı çalışmalı**, **ETA bilgisi kullanıcıya anlık yansıtılmalıdır.** |
| RTP-05 | [Z] | **Kısıt etkileşimi (önemli):** Gerçek zamanlı rota optimizasyonu (RTP-04), **YAS-01 ile sınırlıdır.** Optimizasyon yalnızca kanton **onaylı rota/bölge sınırları içinde** sıralama/zamanlama yapabilir; aracı onaylı rota dışına yönlendiremez. Bu öncelik geliştiricide net olmalıdır. |
| RTP-06 | [Z] | Uzaktan denetim/kontrol için **video gecikmesi düşük tutulmalıdır** (hedef: glass-to-glass < ~500 ms; nihai eşik POC/pilot ile doğrulanır). E-STOP/komut yolu **video yolundan daha sıkı gecikme** garantisine sahip olmalıdır. |
| RTP-07 | [Ö] | Video akışı **talep üzerine** olmalıdır: sürekli sokak görüntüsü kaydı, hem maliyet hem **nDSG gizlilik (privacy-by-design)** gerekçesiyle varsayılan değildir. |
| RTP-08 | [Z] | Gerçek zamanlı/teleoperasyon verisi **tamponlanıp sonradan oynatılmaz**; bağlantı bozulursa veri geciktirilerek "yetişmeye çalışılmaz", güvenli moda geçilir (bkz. DAY-01). |

## 6. Dayanıklılık, Güvenli Mod ve Bağlantı Kısıtları (DAY)
 
| ID | Seviye | Kısıt |
|---|---|---|
| DAY-01 | [Z] | **Bağlantı kesildiğinde araç güvenli moda (safe mode / safe-stop) geçmelidir.** Bu davranış araç tarafında **bağlantıdan bağımsız** (yerel, çevrimdışı çalışan bir mekanizmayla) garanti edilmelidir; buluta bağımlı olmamalıdır.|
| DAY-02 | [Z] | **Bağlantı yeniden kurulduğunda loglar senkronize edilmelidir** (çevrimdışı dönemde biriken gerçek-zamanlı-olmayan veri kayıpsız aktarılır). |
| DAY-03 | [Z] | Güvenli mod tetikleyicileri en az şunları içermelidir: bağlantı kaybı, heartbeat kaybı, video donması/gecikmesi ve **bölge/geofence ihlali**. Tetikleme mantığı, hatalı tetiklemeyi (false safe-stop fırtınası) önleyecek biçimde dereceli/hız-uyarlı olmalıdır; ancak güvenli moda geçme garantisinden ödün verilmez. |
| DAY-04 | [Z] | Güvenli mod kademeli olmalıdır: yetkili biri ilgili durumu ortadan kaldırana kadar araç kendiliğinden harekete geçmez; her giriş bir olay kaydı oluşturur ve ilgili oturum kaydını korur. |
| DAY-05 | [Z] | **Bağlantı dayanıklılığı:** Tek bir hücresel hattın kopması operasyonu kırmamalıdır; çoklu taşıyıcı / yedekli bağlantı desteklenmelidir. (Not: İsviçre arazisinde tünel/vadi ölü bölgeleri öngörülmelidir.) |
| DAY-06 | [Z] | Bağlantı bozulduğunda kademeli düşüş (graceful degradation) uygulanır: önce kalite düşürülür, kontrol korunmaya çalışılır, gerekirse güvenli moda geçilir. |

> Bağlantı kaybı: Araç ile bulut arasındaki iletişim hattının kopması. Araç artık komut alamıyor/veri gönderemiyor demektir; bu durumda kendi başına güvenli moda geçer.

> Heartbeat kaybı: Araç düzenli aralıklarla buluta "ben buradayım, çalışıyorum" sinyali (heartbeat) gönderir. Hat teknik olarak açık görünse bile bu sinyaller beklenen süre içinde gelmiyorsa, sistemin/iletişimin sağlıksız olduğu anlaşılır ve güvenli moda geçilir. (Yani "tam kopma" olmadan da, "donmuş/yanıtsız" durumu yakalar.)

> Video gecikmesi/donması: Operatöre gelen kamera görüntüsünün güncellenmeyi durdurması veya kabul edilemez ölçüde gecikmesi. Operatör güncel görüntü görmeden aracı denetleyemeyeceği için, araç güvenli moda alınır.

> Bölge/geofence ihlali: Aracın, kanton onaylı çalışma bölgesinin (geofence = harita üzerinde tanımlı sınır) dışına çıkması. Araç bu sınırı aştığında otomatik olarak güvenli moda geçer.

## 7. Platform ve Altyapı Kısıtları (PLT)
 
| ID | Seviye | Kısıt |
|---|---|---|
| PLT-01 | [Z] | Sistem **AWS üzerinde** çalışmalıdır. |
| PLT-02 | [Z] | AWS Altyapı, bölge seçimi açısından **İsviçre/AB veri koruma kısıtlarıyla (VER-08) uyumlu** olmalıdır.|
| PLT-03 | [Ö] | Seçilen servisler, **yaşam döngüsü/uzun ömürlülük** açısından değerlendirilmelidir (kapanma/maintenance moduna alınma riski olan servislerden kaçınılmalı; gerekirse ince soyutlama katmanlarıyla değiştirilebilirlik korunmalıdır).|

## 8. Erişilebilirlik Kısıtları (ERS)
 
| ID | Seviye | Kısıt |
|---|---|---|
| ERS-01 | [Z] | Arayüz **en az WCAG 2.1 AA** seviyesini karşılamalıdır (ileriye dönük hedef: WCAG 2.2 AA). İsviçre **eCH-0059** ile hizalı olmalıdır. |
| ERS-02 | [Z] | **Büyük metin / metin yeniden boyutlandırma:** İçerik, işlevsellik kaybı olmadan **%200'e kadar büyütülebilmelidir.** |
| ERS-03 | [Z] | **Yüksek kontrast** ve yeterli renk kontrastı sağlanmalıdır; bilgi yalnızca renkle aktarılmamalıdır. |
| ERS-04 | [Z] | **Klavye ile tam kullanılabilirlik** ve ekran okuyucu uyumu sağlanmalıdır. Özellikle **E-STOP / acil durdurma** kontrolü büyük, belirgin ve klavyeyle erişilebilir olmalıdır. |
| ERS-05 | [Ö] | Yayınlanan bir **erişilebilirlik beyanı (accessibility statement)** öngörülmelidir (BehiG revizyonu bunu gerektirebilir). |
| ERS-06 | [K] | **AB pazarı aşamasında** ek olarak **EAA (European Accessibility Act)** ve EN 301 549 değerlendirilmelidir. Şu an İsviçre içi kapsam için birincil değildir. |

> ⚠️ TODO: Yasalar yeniden incelenecek.

> Joppilot belediyelere (kamu) ve operatörlere hizmet verdiğinden, İsviçre erişilebilirlik mevzuatı doğrudan ilgilidir. İsviçre teknik dayanağı **eCH-0059** olup uluslararası **WCAG**'ı referans alır; **BehiG** revizyonunun (beklenen yürürlük 1 Ocak 2027) özel sektör dijital hizmetlerini de kapsaması öngörülmektedir. 

> **BehiG**: Engellilerle Ayrımcılık Yasası

> **WCAG** (Web Content Accessibility Guidelines), W3C'nin Web Accessibility Initiative (WAI) tarafından geliştirilen, dijital erişilebilirliğin uluslararası fiili standardıdır. **WCAG 2.1 AA + eCH-0059** İsviçre'nin yasal teknik dayanağıdır.

> WCAG Seviyeler: **A** en düşük (ciddi engelleri kaldıran temel ölçütler), **AA** ek bariyerleri kaldırıp ekran okuyucular dahil yardımcı teknolojilerle çoğu engelli kullanıcı için çalışan bir seviye kurar, **AAA** ise en katı/erişilemez olabilen seviyedir. AAA tipik olarak zorunlu tutulmaz çünkü bazı ölçütler her içerik türü için karşılanamaz; AA, AB Erişilebilirlik Yasası, UK Equality Act, US Section 508 gibi neredeyse tüm erişilebilirlik yasalarının atıf yaptığı hedeftir. 

> WCAG 2.1 vs WCAG 2.2: WCAG 2.2, 5 Ekim 2023'te W3C Tavsiyesi oldu; 2.1'in katı bir üst kümesidir (kaldırılan tek ölçüt hariç), dolayısıyla 2.2 AA'yı karşılayan otomatik olarak 2.1 AA'yı da karşılar ve 2.2'yi hedeflemenin bir dezavantajı yoktur. 2.0, 2.1 ve 2.2'nin üçü de geçerli standarttır; 2.2, 2.1'i geçersiz kılmaz, W3C en güncel sürümün kullanılmasını teşvik eder. 

> ERS-05: BehiG, web sitesinde açıkça görüntülenmesi gereken biçimsel bir erişilebilirlik beyanı (Erklärung zur Barrierefreiheit) ister; beyan, eCH-0059/WCAG 2.1 AA uyumunu belirten bir uyum bildirimini ve oluşturma/son gözden geçirme tarihlerini içermelidir. 

> ERS-06 (AB aşaması - EAA/EN 301 549): İsviçre dışına çıkınca devreye girer. AB üyesi olmayan İsviçre'deki bir işletme AB ülkelerine mal/hizmet sunduğunda, web sitesinin EAA ile uyumlu olması (yani EN 301 549 üzerinden WCAG 2.1 AA'yı karşılaması) gerekir. EAA Haziran 2025'te yürürlüğe girdi ve EN 301 549'a (WCAG'ı içeren AB standardı) uyumu gerektirir. 

## 9. Dil ve Yerelleştirme Kısıtları (DIL)
 
| ID | Seviye | Kısıt |
|---|---|---|
| DIL-01 | [Z] | Sistem **birkaç dili desteklemelidir.** Evrensellik için **İngilizce (en)** her durumda bulunmalıdır. |
| DIL-02 | [Z] | Hedef ilk 3 kanton (GL, ZH, BS) **Almanca konuşulan** kantonlardır; bu nedenle **Almanca (de-CH)** ve **İngilizce (en)** mevcut operasyon için birincil dillerdir. |
| DIL-03 | [Ö] | İsviçre genelinde genişlemeye hazırlık için mimari, **Fransızca (fr-CH)** ve **İtalyanca (it-CH)** eklenmesini engellememelidir (anahtar tabanlı çeviri altyapısı). |
| DIL-04 | [Z] | İsviçre yerel biçimleri desteklenmelidir: sayı biçimi (örn. 1'234.56), tarih biçimi (gg.aa.yyyy) ve **Europe/Zurich** saat dilimi. |
 
## 10. Operasyonel ve Ölçek Kısıtları (OPS)
 
| ID | Seviye | Kısıt |
|---|---|---|
| OPS-01 | [Z] | **Bağlayıcı mevcut ölçek: ortalama 10 araçlık bir filo** uzaktan kontrol ve izlenmelidir. Tasarım ve testler **bu ölçek** üzerinden boyutlandırılır. |
| OPS-02 | [Z] | Her araç için **en az 5 kamera akışı** (bkz. RTP-01) ve gerçek zamanlı sensör/diyagnostik akışı, **10 araçlık filonun tamamı için eşzamanlı** desteklenmelidir. |
| OPS-03 | [K] | Araç miktarının yakın zamanda artması planlanmasa da, seçilen kritik teknolojilerin dikey büyümeyi imkansız kılmaması gerekmektedir. Ancak dikey büyüme birincil hedef değildir.|
| OPS-04 | [Ö] | Uzaktan denetim video oturumları **talep üzerine** açıldığından (RTP-07), eşzamanlı oturum sayısı filo büyüklüğünden bağımsız ve sınırlıdır; kaynak planlaması buna göre yapılmalıdır. |
 
## 11. Standartlar ve Uyumluluk Kısıtları (STD)
 
| ID | Seviye | Kısıt |
|---|---|---|
| STD-01 | [Ö] | Sürücüsüz araç bağlamında ilgili fonksiyonel güvenlik ve siber-güvenlik standartlarıyla (örn. ISO 26262, ISO 21448/SOTIF, ISO/SAE 21434, UNECE R155/R156) **hizalanma** gözetilmelidir. Tam güvenlik vakası araç tarafının sorumluluğundadır; Joppilot bu standartların **kendisine dokunan** kısımlarına (örn. yazılım güncelleme yönetimi = R156, siber-güvenlik yönetimi = R155) uyum kanıtı üretebilmelidir. |
| STD-02 | [Z] | **Yazılım/yapılandırma güncellemeleri kontrollü olmalıdır** (kademeli yayma + geri alma). Bu, hem güvenli operasyon hem de aracı güncel/bakımlı tutma yükümlülüğünün (OAD sahip yükümlülüğü) gereğidir. |

 
