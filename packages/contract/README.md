# @joppilot/contract

Bu paket, Joppilot projesindeki tüm mikroservislerin, arayüzlerin (Console) ve Araç (Edge) yazılımlarının ortak konuştuğu **Veri Sözleşmesini** barındırır.

## Yapı (Zod tabanlı)
Tüm modeller `src/index.ts` içerisinde [Zod](https://zod.dev/) ile tanımlanır. Bu bize çalışma zamanında (runtime) güçlü doğrulama imkanı sunar.

## JSON Schema Dışa Aktarımı
Rust tabanlı olan `edge/sim` projesinin bu kurallardan haberdar olması için Zod şemalarımız JSON Schema'ya dönüştürülür.

Derlemek için:
```bash
pnpm run build
```
*(Bu komut `schemas/` klasörüne güncel JSON dosyalarını çıkarır)*

## Testler
Tüm sözleşme validasyonları Vitest kullanılarak yazılmıştır. Testleri çalıştırmak için:
```bash
pnpm run test
```
