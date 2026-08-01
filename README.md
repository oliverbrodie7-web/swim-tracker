# Swim

A small web app for tracking a goal of swimming 100 km in 2026. It reads and writes swim data in Supabase, works offline, and is designed to live on an iPhone home screen.

**Live app: https://oliverbrodie7-web.github.io/swim-tracker/**

## Add it to your iPhone home screen

1. Open the live link above in Safari on your iPhone.
2. Tap the Share button (the square with an arrow pointing up).
3. Scroll down, tap "Add to Home Screen", then tap "Add".

It will appear as an app called Swim with a terracotta wave icon, and it opens full screen like a normal app.

## What it does

- Dashboard with total distance, a pool lane progress visual, ahead or behind plan, and this week's target
- Log a swim with metres, time, longest unbroken stretch, effort, warm up and notes
- Full list of every swim with edit and delete
- The weekly plan through to December 2026, week by week
- Insights: progress against plan, pace trend, unbroken distance trend, weekly volume, a projected finish date and personal records
- Works offline: swims logged without signal are queued and synced automatically when connectivity returns

## Tech

Plain HTML, CSS and JavaScript with no build step. Chart.js from a CDN for the charts. Data lives in a Supabase table accessed through its REST API with the public anon key. Hosted on GitHub Pages with a service worker for offline use.
