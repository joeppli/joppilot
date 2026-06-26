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
