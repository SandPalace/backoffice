// Adapted from the owner's google-maps-scraper skill. Browser-side function: not run with Node.
// Template script for extracting Google Maps card metadata for a slice [START, END).
//
// HOW TO USE:
//   1. Read this file.
//   2. Replace __START__ and __END__ with integers (e.g., 0 and 7).
//   3. Pass the resulting string as the `function` parameter to
//      mcp__plugin_backoffice_playwright__browser_evaluate.
//
//   Example: for batch 2 (cards 7..14), replace __START__ with 7 and __END__ with 14.
//
// Why batches of ~7? Each card needs a click + ~1.5s settle, and the MCP
// evaluate call has a ~30s soft cap. 7 cards * ~2s = ~14s — comfortable margin.
//
// Returns an array of objects with these keys:
//   idx, name, mapsUrl, rating, reviews, address, phone, website,
//   websiteHost, category, hours, plusCode

async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = [];
  const cards = Array.from(document.querySelectorAll('div.Nv2PK')).slice(__START__, __END__);

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const link = card.querySelector('a.hfpxzc');
    if (!link) continue;

    const name = link.getAttribute('aria-label') || '';
    const mapsUrl = link.href || '';
    const rating = card.querySelector('span.MW4etd')?.textContent || '';
    const reviews = card.querySelector('span.UY7F9')?.textContent?.replace(/[()]/g, '') || '';

    // Open the detail panel
    link.scrollIntoView({ block: 'center' });
    await sleep(200);
    link.click();
    await sleep(1500);

    let address = '', phone = '', website = '', websiteHost = '';
    let category = '', hours = '', plusCode = '';

    const main = document.querySelector('div[role="main"][aria-label]');
    if (main) {
      // Address / phone / website / plus code live in data-item-id attributes.
      // Key off the attribute prefix (language-agnostic) — not visible labels.
      main.querySelectorAll('button[data-item-id], a[data-item-id]').forEach(b => {
        const id = b.getAttribute('data-item-id') || '';
        const txt = (b.getAttribute('aria-label') || b.textContent || '').trim();
        if (id.startsWith('address')) {
          address = txt.replace(/^(Dirección|Address|住所):\s*/i, '');
        } else if (id.startsWith('phone')) {
          phone = txt.replace(/^(Teléfono|Phone|電話):\s*/i, '');
        } else if (id.startsWith('authority')) {
          website = b.href || '';
          websiteHost = txt.replace(/^(Sitio web|Website|ウェブサイト):\s*/i, '');
        } else if (id.startsWith('oloc')) {
          plusCode = txt.replace(/^Plus [Cc]ode:\s*/i, '');
        }
      });

      // Category sits in a button with class DkEaL.
      const catBtn = main.querySelector('button.DkEaL');
      category = catBtn?.textContent?.trim() || '';

      // Hours table — rows are <tr> with day in 1st <td>, time range in 2nd <td>.
      const ht = main.querySelector('table.eK4R0e');
      if (ht) {
        const h = [];
        ht.querySelectorAll('tr').forEach(r => {
          const d = r.querySelector('td:first-child')?.textContent?.trim();
          const t = r.querySelector('td:nth-child(2)')?.textContent?.trim().replace(/\s+/g, ' ');
          if (d && t) h.push(`${d}: ${t}`);
        });
        hours = h.join(' | ');
      }
    }

    out.push({
      idx: __START__ + i,
      name, mapsUrl, rating, reviews,
      address, phone, website, websiteHost,
      category, hours, plusCode
    });
  }

  return out;
}
