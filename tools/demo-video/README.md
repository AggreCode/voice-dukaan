# Mo Dokan teaching video (Odia)

A three-minute portrait video, 1080×1920, that walks a shopkeeper through the real app in Odia:
signing up, Sell and Buy, speaking a bill, photographing a wholesaler's bill, unsaved bills, stock and
the report. It is filmed from the actual app, so when the app changes, re-render it.

```bash
./make_video.sh                           # captions only
SARVAM_API_KEY=sk_... ./make_video.sh     # with an Odia voice (Sarvam Bulbul, about ₹5 per render)
```

Output in `out/`: `mo-dokan-odia.mp4` (or `-captions.mp4` without a key) and `cover.jpg` for sharing.

Voiced lines are kept in `work/audio/` and reused while their words, voice and pace are unchanged, so
re-rendering after an app change needs no key and costs nothing; only edited lines go to Sarvam.
`out/voices/` has short samples of four female voices to compare.

**Check it before sharing.** `python contact_sheet.py` tiles a frame from late in each step into
`work/check/sheet.png`. Look at it: every fault this tool has found so far showed up there and in no
log -- a number typed into the wrong box, a microphone stuck on "Get ready", a confirmation scrolled
off screen, and the app offering Moong Dal as Toor Dal.

**Changing the words.** Every spoken line, and its caption, is in `narration.or.json`, with an English
gloss beside it. Edit the `or` line and re-run. `voice` picks the Sarvam speaker (for example `ritu`,
`kavya`, `ratan`, `anand`) and `pace` the speed.

**How it works.** `tts.py` voices each line and measures it; `seed_demo.py` builds a demo shop on a
throwaway database; `record.mjs` drives the app in Chromium inside a phone frame, holds each screen for
as long as its sentence takes, and films the compositor frame by frame; `assemble.py` turns that into
H.264 and lays each sentence at the moment its screen appeared.

Needs: the backend venv, Node 18+, about 300 MB for Chromium on first run. No admin rights.
