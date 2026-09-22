# Italy Bill Split

A phone-friendly page for splitting restaurant and shop bills on a trip. Open it at the table, photograph the receipt, and the app asks who each line belongs to. Lines you already marked on the paper are read automatically and skipped.

Everything stays in your browser. No server, no account, no data leaving your phone except the receipt photo you send to Anthropic for reading.

## Getting started

1. Open `index.html` in a phone browser. Host it on GitHub Pages or any static host, then add it to your home screen so it opens like an app and works without a connection.
2. On the **Trip** tab, add everyone travelling. Give each person a notation, usually their initials. This is what you scribble beside a line on the paper receipt.
3. Set the euro to Canadian dollar rate. Every total shows in both currencies.
4. Optional: paste an Anthropic API key so photos are read by Claude.

## Couples and households

Travelling as couples? Put people who settle together into a household on the Trip tab.

- Lines are still assigned to whoever ordered them, so you keep the detail of who ate what.
- A couple chip appears in the assignment queue. One tap puts a shared line on both partners.
- The Who owes tab totals by household, with each person's share shown beneath.
- Whichever partner pays a bill, the household is credited. The other couple owes the household, not the individual.
- Anyone not in a household settles on their own, alongside the couples.
- A household holds any number of people, so a family works the same way.

## Using it at the table

- **Receipts tab**, add a receipt, set the place and who paid.
- Add the receipt photo, either from your photo library or taken there and then. Claude reads the items, the amounts and any handwritten initials beside a line. Photographing receipts over dinner and sorting them out later at the hotel works well.
- Every line shows a plain English reading under the Italian, so you know what you are assigning. Branzino alla griglia reads as Grilled sea bass.
- Lines carrying a notation are assigned on the spot. The app shows "noted on receipt" beside them.
- Lines with no notation come up one at a time. Tap the people sharing the line, then Next. Tap Everyone for shared plates, wine and coperto.
- Add a tip or rounding at the bottom. It rides on each person's share of the items.
- Enter the printed total as a check. The app flags any difference between your lines and the receipt.

## Reading receipt photos

Three ways in, in order of accuracy:

| Method | Setup | Notes |
|---|---|---|
| Claude vision | Paste an API key on the Trip tab | Best on Italian receipts. Reads handwritten initials. Roughly a cent per receipt. |
| On-device OCR | None | Free, runs in the browser via Tesseract. Expect missing lines, wrong amounts and garbled names on faded thermal paper, so check every line. The photo is upscaled and binarized against a local average first, which lifts faint print off the background. Needs a connection the first time to fetch the reader. |
| Manual or paste | None | Type lines by hand, or paste receipt text and let the app split it into items. |

Get an API key at console.anthropic.com. It is stored in your browser's local storage on your own device and sent only to `api.anthropic.com`. It is never written to this repository. Anyone with access to that phone has access to the key, so use a key with a spending limit.

Review every line before assigning. OCR misreads faded receipts, and a wrong amount splits a wrong number. A receipt read on the device carries a warning above its lines saying exactly that.

Photos are kept only as a small thumbnail for your reference. The full image is used for reading and then discarded, because a few full-size photos would fill the browser's storage and stop the trip itself from saving.

## Translation

Item names stay in Italian, matching the paper, with an English reading underneath.

- Photos read by Claude come back with the translation in the same call. No extra cost, no second request.
- Lines you type, paste or pull off on-device OCR run through a built-in glossary of around 350 restaurant, bar and grocery terms. Works with no connection.
- The glossary stays quiet when it recognises too little, rather than guessing. Those lines show the Italian alone.
- The English reading is carried into the CSV as its own column.

## Exchange rates

Set one trip rate on the Trip tab and every figure converts at it. When the card statement later shows what a receipt actually cost, enter that instead.

- Actual charged in CAD sits on each receipt, under the printed total.
- Enter it and that receipt converts at its own rate, derived from the amount you entered divided by the receipt's euro total.
- Every line, every person's share and the receipt total follow immediately.
- The receipt shows the rate it used and how far it sits from your trip rate, which is the card issuer's spread in plain sight.
- Receipts with no actual carry on at the trip rate. The two live side by side.
- Euros never move. The split, who owes whom and the settlement all run in euros, since that is the currency you actually paid in.
- Where a figure spans receipts that converted differently, such as a settle-up transfer, the app uses a blended rate weighted by what each receipt cost, and says so.
- The CSV carries the rate used and its source, receipt by receipt.

## Notation on the paper receipt

The app matches these against each line:

- A person's notation, their full name, or their first name. `Vino rosso J` goes to Jason.
- Several people at once: `Tiramisu J+M` splits between Jason and Maria.
- Shared markers: `ALL`, `tutti`, `everyone`, `shared`, `tavolo`, or `*`.

Anything else comes up in the queue for you to assign.

## Splitting and settling

- A line split between two people splits evenly.
- Everyone means everyone on the trip at the moment you tapped it. Adding a traveller later leaves earlier shared lines alone.
- Odd cents are handed out one at a time, rotating between people, so every receipt adds back to the exact total. Nothing is lost to rounding.
- Discounts go in as negative amounts and are shared the same way.
- The **Who owes** tab nets what each person paid against what they owe, then lists the fewest transfers that clear every balance.

## Exports

- **Copy summary text** for pasting into a message thread.
- **Download CSV** for every line, its owners, both currencies and the settlement. Opens in Excel.
- **Download backup** on the Trip tab saves the whole trip as JSON, dated. The card nags you if the last one is over three days old, or if you have never taken one.
- **Restore from backup** puts a downloaded file back. It replaces what is on the phone, and takes a snapshot first so the restore itself is undoable.

## Updating the app

The Trip tab shows which build you are running, stamped with the commit and date at deploy time.

- The app asks the network first, so opening it online gets the current version straight away. The cache is the fallback, which is what keeps it working with no connection.
- When a new version is published while you have the app open, a banner appears at the bottom. One tap applies it and reloads.
- Nothing changes underneath you mid-receipt. The new version waits until you tap.
- Check for updates on the Trip tab forces a look, and says plainly whether you are current.
- Your trip data lives in localStorage and is untouched by an update. Roster, receipts, assignments and the rate all carry over.
- Offline, the check reports it could not reach the server and the app keeps working from cache.

## Where the data lives

The trip is held on the phone, in IndexedDB. Nothing is sent anywhere.

- IndexedDB has room in the hundreds of megabytes. The old store was localStorage, with about five, which a few receipt photos would have filled.
- A trip saved by an older version is read across the first time it loads, then the old copy is cleared out.
- Every ten minutes of activity the app keeps a snapshot, holding the last twenty. A restore also snapshots first.
- If a private window refuses IndexedDB, saving falls back to localStorage. The Trip tab says which one is in use and how much is stored.
- If saving fails outright, a red banner appears on every tab telling you to take a backup. It is never a quiet failure.

None of this survives a lost phone or a cleared browser. Take a backup.

## Tests

```
node test/logic.test.js
```

Covers notation matching, Italian decimal parsing, receipt text parsing, cent-exact splitting, tip allocation and settlement. No dependencies.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app: markup, styles and logic |
| `sw.js` | Service worker so the page opens offline |
| `manifest.webmanifest`, `icon.svg` | Home screen install |
| `test/logic.test.js` | Test suite |
