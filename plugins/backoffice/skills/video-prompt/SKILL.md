---
name: video-prompt
description: Writes video-generation prompts (Seedance, Veo, Sora, Kling, Runway...) for an approved piece, one shot per generation, with camera, movement and duration, with no text in frame. Use it when asked for a "video prompt", "reel", "clip", "video ad" or a storyboard.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Video prompt

## Procedure

1. Read the piece in `calendar.csv`: only if its status is `approved`, verified with `backoffice_task_list` (task `done`). If not, say so and stop.
2. Derive from the brief (`marketing/<business>/brief.md`, voice and colors) and from `facts.md` (only `confirmed`), read with `backoffice_file_read`, not from another generated video.
3. Script first: use `content-script` (hook, engagement, blocks, re-hook, call to action). The shots come from that script.
4. Split into shots of 3-8 s (15 s = 3-4 shots). One shot = one generation; a prompt with three scenes produces a blend.
5. Shot 1 with a hook: movement, contrast or something unexpected in the first second; not a logo.
6. Per shot, a prompt in English with 6 parts: subject and action, scene, camera, movement and rhythm, light and style, technical (duration, aspect ratio, `no text on screen, no letters, no logos`).
7. Prefer hands, backs and product over faces: no recognizable generated people or minors.
8. On-screen text and voice are done afterwards in editing: note them separately per shot.
9. Save with `backoffice_file_write` to `marketing/<business>/creatives/Pxx_vN.md` (storyboard, verbatim prompt per shot, on-screen text, voice, facts used with source). Never overwrite: `_v2`. Move the task to `review` and register with `backoffice_task_deliver` (`files`).

## Exact output format

```markdown
# Pxx_vN · Video · <aspect> · <duration> · model <model>
Facts used: <fact> (facts.md, <source>) | "none"
## Storyboard
| shot | sec | what is seen | prompt (verbatim) | on-screen text (editing) | voice |
```

Example (sample data; on-screen text and voice are deliverable content, in the person's language):

```markdown
# P02_v1 · Video · 9:16 · 15 s · model (to be defined)
Facts used: none
| 1 | 0-5 | hands connect a cable | Hands snap the last wire into a small robot, LEDs light up, classroom desk, close-up, slow push-in, eye level, bright natural light, 5 seconds, 9:16 vertical, no text on screen, no letters, no logos | 4 COSAS | "4 cosas que tu hijo puede construir" |
```

## Never

- Ask for several scenes in a single prompt.
- Put text, subtitles or logos inside the generated video.
- Generate recognizable faces or minors.
- Overwrite a version or derive from another generated one.

## Why

A one-shot prompt gives a predictable result, and text composed in editing can be fixed without regenerating. Testing both styles (person on camera and generated) with your own data avoids assuming that the more expensive one sells more.
