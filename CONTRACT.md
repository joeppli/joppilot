# Joppilot Contract Strategy

Bu proje, **Contract-First** (Sözleşme Odaklı) bir mimari üzerine kuruludur.

Tüm servisler, arayüzler ve sınır sistemleri, ortak bir veri ve komut dili konuşmak zorundadır. Bu dili tanımlayan tek kaynak (Single Source of Truth) **`packages/contract`** modülüdür.

## Neden Contract-First?
1. **Tip Güvenliği:** Backend ve Frontend aynı TypeScript (Zod) tiplerini tüketir.
2. **Platform Bağımsızlığı:** Rust ile yazılan Edge (Araç İçi) yazılımı, TypeScript kullanamaz. Bu yüzden Zod şemalarımız, derleme aşamasında otomatik olarak **JSON Schema** dosyalarına dönüştürülür (`packages/contract/schemas/*.json`). Rust bu şemaları okuyarak veri doğrulaması yapar.
3. **Güvenlik (Fencing Token):** Aynı aracı birden fazla kişinin sürmesini engelleyen ve zombi komutları filtreleyen `Fencing Token` (Kilit Jetonu) mekanizması bu sözleşme ile zorunlu kılınmıştır.

## Değişiklik Yaparken
Yeni bir komut veya telemetri alanı ekleyecekseniz:
1. Sadece `packages/contract/src/index.ts` dosyasında Zod tanımını güncelleyin.
2. `pnpm build` komutu ile yeni JSON Schema dosyalarının üretildiğinden emin olun.
3. Diğer servisler (`services/command`, `apps/console`, `edge/sim`) yeni kontrata göre kendi içlerinde uyarlanmalıdır.

## Bilinen Bilinçli Boşluklar ve Özel Kurallar

1. **Zone-mode matrisi İKİ yerde yaşar** (Rust, TS import edemez): `packages/contract/src/index.ts` (`ZONE_MODE_MATRIX`) ve `edge/sim/src/main.rs` (`mode_allowed_in_zone` / `diag_disruptive_allowed`). ICD §1 matrisi değişirse **ikisini birden** güncelleyin ve `services/command/test/smoke-edge.cjs` çalıştırın. Kalıcı çözüm (M3-1 hedefi): matrisi diğer şemalar gibi üretilmiş JSON olarak yayınlamak ve edge'in açılışta okuması.
2. **`CommandEnvelope.signature` şimdilik opsiyonel** — ICD §4 her komutta imza şart koşar; yerel prototipte anahtar altyapısı (PKI/HSM) olmadığı için doğrulanabilir imza üretilemez ve **sahte/placeholder imza doldurulmaz** (yanlış kanıt, kanıtsızlıktan kötüdür — LEG-04/05 kanıt zinciri). Komut kanalı IoT Core'a taşınınca (M2-5, X.509 + mTLS): Gate 1 imzalar, araç doğrular, imzasız zarf NACK alır ve alan şemada zorunlu yapılır.
3. **`CommandEnvelope.correlationId` M2-4'te zorunlu olacak** — WORM/EDR denetim zinciri (SEC-06) kayıtları bu id ile ilişkilendirir; kripto gerektirmez. Gerçek servisler AWS'e taşınırken (M2-4): console göndermezse Gate 1 üretir, her EDR kaydı taşır, alan şemada zorunlu yapılır.
