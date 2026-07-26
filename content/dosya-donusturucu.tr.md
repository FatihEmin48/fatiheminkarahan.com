---
title: Dosya Dönüştürücü
---
PDF, Word, Excel, resim ve metin dosyalarını birbirine çeviren, tamamen tarayıcıda çalışan dönüştürücü. Dosyalar yüklenmez, sunucuya gitmez; her dönüşüm cihazın içinde yapılır ve uygulama çevrimdışı çalışır.

<!--more-->

Resimler (PNG, JPEG, WebP, GIF, BMP, AVIF, SVG) birbirine ve tek bir PDF'e çevrilebilir; PDF'ler sayfa sayfa 72–600 DPI görüntüye, metne, Word belgesine, Markdown'a ve HTML'e dönüştürülebilir. PDF araçları arasında birleştirme, sayfalara bölme ve çözünürlük düşürerek küçültme var — birleştirme ve bölmede sayfa nesneleri olduğu gibi kopyalandığı için kalite kaybı olmaz. Word (.docx) ve Excel (.xlsx) dosyaları PDF, metin, CSV ve JSON'a; CSV/JSON/Markdown/HTML dosyaları da birbirine ve PDF/Word'e çevrilebilir.

Her kaynak biçim önce ortak bir paragraf yapısına indirgenir, sonra tek bir yerleşim motoru devralır; böylece kaynak ve hedef sayısı çarpım değil toplam olarak büyür. Üretilen PDF'lere TrueType yazı tipi gömülür (Identity-H + ToUnicode), çünkü PDF'in yerleşik yazı tipleri `ğ`, `ş`, `İ`, `ı` gliflerini içermez — bu sayede Türkçe metin doğru görünür ve PDF içinde seçilebilir, aranabilir kalır. ZIP, DOCX ve XLSX yazımı için ek kütüphane kullanılmaz; tarayıcının Compression Streams API'si yeterlidir.

2007 öncesi ikili `.doc` ve `.xls` biçimleri tarayıcıda açılamaz; uygulama bunu sessizce başarısız olmak yerine açıkça bildirir ve `.docx`/`.xlsx` olarak kaydetmeyi önerir.

Araçlar: JavaScript (ES modülleri), Compression Streams API, pdf.js, pdf-lib, Canvas API, Service Worker

[Uygulamayı aç](/donustur/)
