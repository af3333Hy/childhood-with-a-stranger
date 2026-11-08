# A childhood, with a stranger

ARTD6232 Creative Technologies, Project 1 (networked presence). Yi Han, 38188163, MSc Creative Technologies, Winchester School of Art, 2026.

Two strangers each hold a feeling in their hand. Round by round, their two feelings pick a page of a childhood picture book that neither of them lived. The book ends with a memory bank of the pages they wrote together.

Live (two players, same room name): `https://43-165-7-157.sslip.io/?room=yourname`
Video (60 s): https://af3333hy.github.io/creattech_websites/assets/video/ct1_p1_final_60s.mp4
Portfolio page: https://af3333hy.github.io/creattech_websites/ (Creative Tech 1 > Projects)
Single player test: add `&solo=1`. Skip the opening book: add `&skip=1`.

## In 100 words

A childhood, with a stranger is a two-player picture book. Two strangers each show one hand to the webcam; ml5 reads it as a feeling, a Socket.io server pairs the two feelings, and together they open one page of a childhood that neither of them lived: hand-drawn pixel silhouettes with a caption. After three rounds the pages are bound into a book. Childhood is not found, it is co-written in the present by two people out of shadows. After the crit I added a last page where the player leaves one memory of their own, so the next two strangers find a story that is partly theirs.

## How it works

1. Opening picture book (41 s): eight childhood objects turn to coloured sand, the book tilts, a hand turns four pages, three questions.
2. Each round: a countdown, then the webcam reads one hand gesture with ml5 handPose (rock = calm, scissors = sad, paper = happy, and an L shape = surprised). The gesture is held 0.45 s before it counts.
3. Both feelings go to the server. The server waits for the pair and sends `both` back to the two browsers.
4. The pair of feelings selects one of 16 pre-written pages: the other player's face fades in, then a silhouette scene with a caption.
5. Three rounds, then the pages are assembled into a four-frame strip, a book flips through them, and the player chooses again (V sign) or stay (open hand).

## Stack

- `public/sketch_v6.js` - p5.js, the whole flow as a state machine (opening, rps, reveal, scene, strip, ending), timing constants at the top, Web Audio sound effects synthesised in code.
- `server.js` - Express + Socket.io, about 40 lines of room logic: first to join is the boy, second is the girl, the server collects both gestures per round and relays `pause` and `bookskip` so both screens stay in step.
- `public/lines.json` - every sentence on screen.
- `public/ml5.min.js` - ml5 1.4.0, loaded locally. Finger-up detection and gesture classification are written in the sketch.
- `public/assets/` - pixel art: faces, single actions, 16 pair scenes, silhouettes, gestures, opening objects; `audio/` opening and ending music; `voice/` recorded lines.

## Run locally

```
npm install
node server.js
```

Open `http://localhost:3000/?room=test` in two windows (the first is the boy, the second the girl). Keyboard 1 2 3 stand in for gestures, 5 sends, P pauses both screens, R restarts.

## Deployment

Tencent Cloud Lighthouse (Frankfurt), Node 20, systemd user service `p1`, Caddy reverse proxy for HTTPS (the webcam needs HTTPS).

## Credits and AI use

Faces, hand gestures, single-figure actions, the 16 pair scenes and the silhouettes are hand-drawn pixel art by Yi Han in Piskel. Backgrounds of the nine scenes were painted by Wanning (project partner). The eight opening objects and the background of scene 9 (the moving truck) started from AI-generated images (Jimeng) that were then reduced to the pixel palette and edited. Music: see `assets/audio`. Code structure was planned with Claude; the state machine, timings, gesture rules and all text were written and decided by Yi Han.

## Version history

- v1 (10-22) single-machine flow prototype, four icons and a face.
- v5 (10-25) Socket.io rooms, opening picture book, memory bank of 16 cells.
- v7 (10-28) after Boyd's reply: all pre-written, no typing, nine-scene story.
- v18 (11-01) ml5 handPose, local model, rounds sped up.
- v21 (11-02) frozen for the crit: sound effects, looser gesture rules, countdown fix.
- v22 and v23 (11-03) pause key, faster page flips, click to skip the book.
- v24 and v25 (8 November, after the crit): on the last page the open hand means leave a memory; the player writes one childhood memory of their own, it is kept in memories.json, and the end page shows the pages other people have left. The first visitor is the boy or the girl at random.
