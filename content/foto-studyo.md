---
title: Photo Studio
image: /og/foto-studyo.png
---
A photo filter and editing studio that runs entirely in the browser. Everything is processed on the device GPU: photos are never uploaded to a server, and the app works offline. The same URL opens on phone and desktop, and installs like a native app through "Add to Home Screen".

<!--more-->

28 presets are listed with live thumbnails and their strength is adjustable from 0 to 100; picking a preset never discards manual edits. Twenty-seven sliders across five groups (exposure, highlights/shadows, temperature, vibrance, clarity, vignette, film grain, split toning…) sit alongside a live histogram and a one-tap auto-enhance. The crop tool offers 11 aspect ratios, 90° rotation and ±45° straightening; while straightening, the crop frame automatically settles into the largest rectangle that leaves no black corners. The tone curve works per RGB and per channel, using monotone cubic interpolation so the curve cannot overshoot and invert tones.

Text and emoji stickers can be placed over the photo: drag to move, and use the corner handle to scale and rotate at once. Five frame styles are available (border, polaroid, rounded corner, hairline). Zooming does not magnify pixels — the visible region is re-rendered at the same pixel count, so real detail is visible. Preview and export share the same render pipeline, which means what is on screen is exactly what gets saved.

Built with: JavaScript (ES modules), WebGL (GLSL shaders), Canvas 2D, Service Worker

[Open the app](/foto/)
