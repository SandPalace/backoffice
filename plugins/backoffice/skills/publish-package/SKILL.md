---
name: publish-package
description: Prepares the publishing package for an approved creative (Instagram, Facebook, TikTok, YouTube Shorts, Meta ads, Google Ads) as a draft and checklist for the person to publish. It never publishes or activates ads. Use it with "publish", "upload it to TikTok/Instagram", "schedule", "put ad spend behind it", or when a creative gets approved.
allowed-tools: mcp__plugin_backoffice_backoffice
---

# Publish (package for the person to publish)

Publishing is the only thing that goes out into the world: real people see it and an ad spends money. **You do not publish,
you do not schedule and you do not activate ads.** You prepare the package and the checklist; the person uploads from their
own account and decides permissions, budget and audiences.

## Procedure

1. **Check approvals.** The piece is `approved` in `calendar.csv` with `approved_by` = person (task
   T-xxxx), and the creatives batch's task is `done` according to `backoffice_task_list`. If not, stop and say so.
2. Read the creative `marketing/<business>/creatives/Pxx_vN.md` (the approved version) and `facts.md` with `backoffice_file_read` for account, destination and goal.
3. Create the package with `backoffice_file_write` as a new file `marketing/<business>/creatives/Pxx_vN_publish.md` (do not edit the approved creative), with:
   - Platform and format, and the exact file to upload (the person downloads it from the web: Archivos tab or the task's delivery).
   - **Literal text** of the approved caption, word for word; if anything changes, it is approved again.
   - Keyword or destination (WhatsApp, web), date and time (the piece's `date`, with `weekday` verified with `date`).
   - How it is measured (what counts as a result, according to `facts.md`).
4. Add the **checklist for the person**, depending on the platform:

| Platform | What the person does |
|---|---|
| Instagram / Facebook | Upload the file from the app, paste the text, check the cover and tags, publish or schedule |
| TikTok | Upload the video, paste the text, choose privacy, publish |
| YouTube Shorts | Upload vertical, 3 min or less, paste title and description, publish from YouTube Studio |
| Meta ads | Create the campaign **paused** in Ads Manager with the package's text; only they activate it, and they set the budget and audience |
| Google Ads | Paste headlines and descriptions (with character limits) and create the ad |

5. What gets ad spend comes from the strategy: the organic winner, not a video that did not work. Account, currency
   and goal come from `facts.md`; if they are not confirmed, ask (piece `blocked`).
6. Deliver: task "Publishing package Pxx", `backoffice_task_deliver` (`files`) and move to `review`. Tell the person:
   "Here is what you need to upload and how; let me know when you publish and give me the link."
7. When the person confirms they published, record `published` in `calendar.csv` (`backoffice_file_write`) and the link they gave.

## When you run into something

A fact that is unconfirmed, a file the platform rejects, a permissions question: you stop, say what
happened, what it means and what the person must do (concrete steps). Do not look for another route, another account or
third-party tools. Never ask for or print passwords or tokens.

## Never

- Publish, schedule or activate ads with credentials or connectors. The only exception is the CMO's `meta-connector`:
  approved ads left **paused** in Ads Manager and organic posts saved as **drafts**, for the person to activate.
- Change the approved text, or prepare a package for a piece without approval in a `done` task.
- Write `published` without the person confirming it.
- Ask the person for a disk path or to open a file from disk.

## Why

What is published cannot be unseen and an ad spends real money. The person publishes, so the permission is theirs and the
copy that went out is the one they approved.
