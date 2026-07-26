---
title: Health Panel
image: /og/saglik-panel.png
---
An offline-first health tracker that brings daily activity, weekly weight and week/month/year analysis into a single screen. iPhone Health data (steps, distance, active calories, exercise minutes) is pushed automatically through a Shortcuts automation, or read from an Apple Fitness screenshot with on-device OCR. The Android build sends the reminders, runs Google ML Kit text recognition on uploaded screenshots and reads the phone's own step data through Health Connect.

<!--more-->

It computes weight trend (kg/week), body mass index and the estimated time to the target weight; period comparisons align the running week/month/year with the same number of elapsed days in the previous period, so a half-finished week is never compared against a full one. Data is stored locally first and synced across devices when the cloud is connected.

Built with: JavaScript (ES modules), Capacitor, Supabase (Postgres + RLS + Storage), Google ML Kit OCR, Apple Shortcuts

[Open the app](/saglik/)
