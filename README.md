# Έμφραγμα: όταν η καρδιά μένει χωρίς αίμα

A one-page interactive biology presentation (in Greek) about myocardial infarction. A 3D heart and a 3D artery show how a heart attack happens step by step, followed by the symptoms, the risk factors, the treatment and what to do in an emergency.

Click the heart at the top to open a full-window 3D explorer of a real anatomical heart. You can rotate and zoom it, switch between x-ray, cut and solid views, see blood flow through every chamber, valve and vessel with a named label on each, and follow one drop of blood around the whole loop.

Built with Vite, three.js and Lenis. Everything is bundled locally, so it works offline on a classroom projector.

```bash
npm install
npm run dev
```

Use the arrow keys to step through it like slides. Inside the explorer, Space plays or pauses the drop tour and Esc closes it.

## Heart model

The explorer uses the heart from BodyParts3D, © The Database Center for Life Science, licensed under CC BY 4.0. It was cut out, recentred and packed into `public/heart/heart.bin` by `scripts/extract-heart.mjs`. See `ATTRIBUTION.md`.

For school use only. This is not medical advice. In an emergency in Greece, call 166 (ΕΚΑΒ) or 112.
