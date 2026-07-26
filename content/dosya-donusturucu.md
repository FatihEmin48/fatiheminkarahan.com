---
title: File Converter
---
A converter for PDF, Word, Excel, image and text files that runs entirely in the browser. Nothing is uploaded: every conversion happens on the device, and the app works offline.

<!--more-->

Images (PNG, JPEG, WebP, GIF, BMP, AVIF, SVG) convert between each other and into a single PDF; PDFs convert page by page into 72–600 DPI images, plain text, Word documents, Markdown and HTML. The PDF tools cover merging, splitting into pages and shrinking by lowering resolution — merging and splitting copy page objects as they are, so there is no quality loss. Word (.docx) and Excel (.xlsx) files convert to PDF, text, CSV and JSON, and CSV/JSON/Markdown/HTML files convert between each other and into PDF or Word.

Every source format is first reduced to a common paragraph structure that a single layout engine then takes over, so the code grows with the sum of sources and targets rather than their product. Generated PDFs embed a TrueType font (Identity-H + ToUnicode) because the built-in PDF fonts lack the `ğ`, `ş`, `İ` and `ı` glyphs — this keeps Turkish text correct while leaving it selectable and searchable inside the PDF. ZIP, DOCX and XLSX writing needs no extra library; the browser's Compression Streams API is enough.

Pre-2007 binary `.doc` and `.xls` formats cannot be opened in a browser; rather than failing silently, the app says so and suggests saving as `.docx`/`.xlsx` first.

Built with: JavaScript (ES modules), Compression Streams API, pdf.js, pdf-lib, Canvas API, Service Worker

[Open the app](/donustur/)
