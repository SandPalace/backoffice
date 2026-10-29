// Adapted from the owner's google-maps-scraper skill. Browser-side function: not run with Node.
// Scroll the Google Maps results panel until at least `target` cards are loaded.
// Pass the entire function below to mcp__plugin_backoffice_playwright__browser_evaluate.
//
// Usage in extract_batch.js style:
//   await page.evaluate(async (target) => { /* this function body */ }, 30);
//
// Returns: { final: <number of a.hfpxzc anchors loaded>, error?: string }

async (target = 30) => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const feed = document.querySelector('[role="feed"]');
  if (!feed) {
    return { error: 'feed not found — possibly consent banner blocking results', final: 0 };
  }

  let lastCount = 0;
  let stable = 0;
  const maxIterations = 25;

  for (let i = 0; i < maxIterations; i++) {
    feed.scrollTo(0, feed.scrollHeight);
    await sleep(1500);
    const count = document.querySelectorAll('a.hfpxzc').length;

    // Stop if we hit target, or if count stops growing
    if (count >= target + 5) break;  // small buffer for dedup
    if (count === lastCount) {
      stable++;
      // 3 stable iterations with at least `target` cards = done
      if (stable >= 3 && count >= target) break;
      // 5 stable iterations regardless = bottom of list
      if (stable >= 5) break;
    } else {
      stable = 0;
    }
    lastCount = count;
  }

  return { final: document.querySelectorAll('a.hfpxzc').length };
}
