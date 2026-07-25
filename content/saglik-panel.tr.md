---
title: Sağlık Panel
---
Günlük spor verisini, haftalık kiloyu ve hafta/ay/yıl analizini tek ekranda toplayan, çevrimdışı çalışan sağlık takip uygulaması. iPhone Sağlık verileri (adım, mesafe, aktif kalori, egzersiz dakikası) Kısayollar otomasyonuyla otomatik aktarılır; istenirse Apple Fitness ekran görüntüsü cihaz üzerinde OCR ile okunur. Android sürümü hatırlatıcı bildirimleri gönderir, yüklenen ekran görüntülerini Google ML Kit ile metne çevirir ve telefonun kendi adım verisini Health Connect üzerinden alır.

<!--more-->

Kilo eğilimi (kg/hafta), vücut kitle endeksi ve hedefe kalan süre hesaplanır; hafta, ay ve yıl karşılaştırmaları sürmekte olan dönemi geçmişin aynı gün sayısıyla kıyaslar. Veriler çevrimdışı öncelikli tutulur, bulut bağlanırsa cihazlar arasında eşitlenir.

Araçlar: JavaScript (ES modülleri), Capacitor, Supabase (Postgres + RLS + Storage), Google ML Kit OCR, Apple Shortcuts

[Uygulamayı aç](/saglik/)
