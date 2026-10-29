<!-- Adapted from the owner's google-maps-scraper skill. -->
# Google Maps DOM contract (May 2026)

These are the selectors the extraction scripts rely on. If Google Maps changes its DOM and the scraper breaks, this is the first place to look.

## Results list (left panel)

| What | Selector | Notes |
|---|---|---|
| Scroll container | `[role="feed"]` | The scrollable div that loads more results when you reach the bottom |
| Result card | `div.Nv2PK` | One per business |
| Card link / name | `a.hfpxzc` | Has `aria-label` with business name, `href` with `/place/` URL |
| Rating number | `span.MW4etd` | "4.9" |
| Review count | `span.UY7F9` | "(288)" — strip parens |
| Phone (visible in list) | `span.UsdlK` | Sometimes shown without clicking in |
| Category + address blob | `div.W4Efsd` | Multiple spans, separated by `·` |

## Detail panel (right side, after clicking a card)

| What | Selector | Notes |
|---|---|---|
| Panel root | `div[role="main"][aria-label]` | The aria-label is the business name |
| Address | `button[data-item-id^="address"]` or `a[data-item-id^="address"]` | aria-label has "Dirección: ..." or "Address: ..." |
| Phone | `button[data-item-id^="phone"]` | aria-label has "Teléfono: ..." |
| Website | `a[data-item-id^="authority"]` | `href` is the actual URL, aria-label is "Sitio web: <host>" |
| Plus code | `button[data-item-id^="oloc"]` | aria-label has "Plus code: ..." |
| Category | `button.DkEaL` | Plain text content |
| Hours table | `table.eK4R0e` | `<tr>` rows, day in first `<td>`, hours in second `<td>` |

## Why we key off `data-item-id` prefixes

The visible labels ("Dirección", "Phone", "住所", etc.) change with the user's `hl=` locale, but the `data-item-id` attribute prefixes (`address`, `phone`, `authority`, `oloc`) are **stable across locales**. That's why the extractor is language-agnostic.

## Things that have broken historically

- Class names like `Nv2PK`, `MW4etd`, `hfpxzc` are obfuscated build hashes and **could change at any time**. If the scraper returns zero results, snapshot the page and grep for the business name to find the new class names.
- Sometimes Maps A/B-tests a new panel layout that uses `<dl>/<dt>/<dd>` instead of `<table>` for hours. If `table.eK4R0e` returns null but the business obviously has hours, check for `dl.OqCZI` or similar.
- The `[role="feed"]` container is stable — that one rarely changes because it's a real accessibility landmark.

## Browser console — quick debug snippets

Paste into DevTools console while on a Maps search results page:

```js
// Count loaded results
document.querySelectorAll('a.hfpxzc').length

// First card's name
document.querySelector('a.hfpxzc')?.getAttribute('aria-label')

// All data-item-ids in current detail panel
[...document.querySelectorAll('div[role="main"] [data-item-id]')].map(b => b.getAttribute('data-item-id'))
```
