# Italy Bill Split

A phone-friendly page for splitting restaurant and shop bills on a trip. Open it at the table, photograph the receipt, and the app asks who each line belongs to. Lines you already marked on the paper are read automatically and skipped.

Everything stays in your browser. No server, no account, no data leaving your phone except the receipt photo you send to Anthropic for reading.

## Getting started

1. Open `index.html` in a phone browser. Host it on GitHub Pages or any static host, then add it to your home screen so it opens like an app and works without a connection.
2. On the **Trip** tab, add everyone travelling. Give each person a notation, usually their initials. This is what you scribble beside a line on the paper receipt.
3. Set the euro to Canadian dollar rate. Every total shows in both currencies.
4. Optional: paste an Anthropic API key so photos are read by Claude.

## Using it at the table

- **Receipts tab**, add a receipt, set the place and who paid.
- Add the receipt photo, either from your photo library or taken there and then. Claude reads the items, the amounts and any handwritten initials beside a line. Photographing receipts over dinner and sorting them out later at the hotel works well.
- Lines carrying a notation are assigned on the spot. The app shows "noted on receipt" beside them.
- Lines with no notation come up one at a time. Tap the people sharing the line, then Next. Tap Everyone for shared plates, wine and coperto.
- Add a tip or rounding at the bottom. It rides on each person's share of the items.
- Enter the printed total as a check. The app flags any difference between your lines and the receipt.

## Reading receipt photos

Three ways in, in order of accuracy:

| Method | Setup | Notes |
|---|---|---|
| Claude vision | Paste an API key on the Trip tab | Best on Italian receipts. Reads handwritten initials. Roughly a cent per receipt. |
| On-device OCR | None | Free, runs in the browser via Tesseract. Weaker on faded thermal paper. Needs a connection the first time to fetch the reader. |
| Manual or paste | None | Type lines by hand, or paste receipt text and let the app split it into items. |

Get an API key at console.anthropic.com. It is stored in your browser's local storage on your own device and sent only to `api.anthropic.com`. It is never written to this repository. Anyone with access to that phone has access to the key, so use a key with a spending limit.

Review every line before assigning. OCR misreads faded receipts, and a wrong amount splits a wrong number.

## Notation on the paper receipt

The app matches these against each line:

- A person's notation, their full name, or their first name. `Vino rosso J` goes to Jason.
- Several people at once: `Tiramisu J+M` splits between Jason and Maria.
- Shared markers: `ALL`, `tutti`, `everyone`, `shared`, `tavolo`, or `*`.

Anything else comes up in the queue for you to assign.

## Splitting and settling

- A line split between two people splits evenly.
- Odd cents are handed out one at a time, rotating between people, so every receipt adds back to the exact total. Nothing is lost to rounding.
- Discounts go in as negative amounts and are shared the same way.
- The **Who owes** tab nets what each person paid against what they owe, then lists the fewest transfers that clear every balance.

## Exports

- **Copy summary text** for pasting into a message thread.
- **Download CSV** for every line, its owners, both currencies and the settlement. Opens in Excel.
- **Download backup** on the Trip tab saves the whole trip as JSON. Do this before you fly home, since clearing browser data wipes the trip.

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
