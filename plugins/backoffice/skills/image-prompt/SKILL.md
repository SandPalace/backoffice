---
name: image-prompt
description: Writes image-generation prompts (7-part formula) for an approved piece, using the brief's palette and clean space for the copy, with no text inside the image. Use it when asked for an "image prompt", "flyer", "post", "product photo" or "background for the ad".
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Image prompt

## Procedure

1. Read the piece in `calendar.csv`: only if its status is `approved`, verified with `backoffice_task_list` (task `done`). If not, say so and stop.
2. Derive from the brief, not from another generated image: read `marketing/<business>/brief.md` (tone, colors in hex) and `facts.md` (only `confirmed` facts) with `backoffice_file_read`.
3. Decide where the copy will go (top, bottom, side) and reserve that space in the prompt.
4. Write the prompt in English with 7 parts: subject, action or state, environment, composition (with "clean empty space in the upper 40% for text"), light, style and camera, palette (hex from the brief) and format (aspect ratio).
5. Always close with: `no text, no letters, no numbers, no logos, no watermark, no recognizable faces`.
6. Two variants, not ten: change a single variable between A and B (light, framing or background).
7. Save with `backoffice_file_write` to `marketing/<business>/creatives/Pxx_vN.md`. If it exists, create the next version; never overwrite. If the person rejects a version, the new one starts from the brief and the piece, not from the previous one; note what changed.
8. When the image is generated, save it with `backoffice_file_write` (`content_base64`) in `marketing/<business>/creatives/` with the note's name (`P01_v1_A.png`) and record measured defects (odd hands, ghost text, color outside the palette); no "it looks good".
9. Move the task to `review` with `backoffice_task_update` and register the files with `backoffice_task_deliver` (`files`).

## Exact output format

```markdown
# Pxx_vN · Image · <aspect> · model <model>
Facts used: <fact> (facts.md, <source>) | "none"
## Prompt A
## Prompt B (changes only: <variable>)
## Copy that goes on top (composed afterwards, not generated)
## Measured defects
```

Example (sample data; the copy that goes on top is deliverable content, in the person's language):

```markdown
# P01_v1 · Image · 4:5 · model (to be defined)
Facts used: none
## Prompt A
A small robot kit with an ESP32 board on a classroom desk, LEDs glowing, bright makerspace, subject in lower third, clean empty space in the upper 40% for text, soft warm window light from the left, editorial product photo, 50mm, palette #5C0F8B and #FFFFFF, aspect ratio 4:5. No text, no letters, no numbers, no logos, no watermark, no recognizable faces.
## Prompt B (changes only: light)
... cool overhead light ...
## Copy that goes on top
"4 cosas que tu hijo puede construir este mes"
```

## Never

- Put text, prices, figures or logos inside the image: the copy is composed afterwards in Canva, Figma or HTML.
- Generate recognizable people or minors, or other brands' logos or characters.
- Overwrite a version; use `_v2`.
- Derive from a generated image.

## Why

A price baked into a pixel cannot be fixed without regenerating everything. Deriving from the brief keeps every copy from drifting away from the brand.
