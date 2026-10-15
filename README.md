# Sudoku — No Ads

A complete, traditional-looking Sudoku game for iPhone or any modern browser. It is **free, ad-free, offline-ready, and has no external dependencies**.

## Included files

Keep these files **together in the root** of the published site:

- `index.html` — the entire game, including layout, CSS, and JavaScript.
- `manifest.webmanifest` — makes the site installable.
- `service-worker.js` — caches the site for offline play.
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — app icons.
- `README.md` — these instructions.

## Features

- Randomly generated 9×9 puzzles, each with exactly one solution
- Easy, Medium, Hard, and Expert (difficulty is **approximate**, based on starting clue count; not rated by advanced Sudoku solving techniques)
- Notes/pencil mode, number highlighting, mistake display, hints, erase, and undo
- Timer that pauses when you leave the app or open a menu
- Automatic local saves, personal best times and statistics
- Keyboard support (1–9, 0/Delete/Backspace, N for notes, Ctrl/⌘+Z, arrow keys)
- iPhone Home Screen install and offline caching
- No servers, logins, advertising, or analytics

## Install directly from an iPhone — no laptop required

1. Download `sudoku-app.zip` and save it to the **Files** app.
2. Open Files and tap the ZIP to unzip it. Open the resulting `sudoku-app` folder.
3. In **Safari**, log into https://github.com (create a free account if needed).
4. Create a **new repository**, for example `my-sudoku`, and set it to **Public**. On GitHub Free, Pages publishing for a project repository requires a public repository.
5. In the repository, select **Add file → Upload files**. Tap **choose your files** and select these six app files from Files: `index.html`, `manifest.webmanifest`, `service-worker.js`, `icon-192.png`, `icon-512.png`, and `apple-touch-icon.png`. You can also upload `README.md` if you want. **Upload the actual files, not the ZIP or an outer folder.** If Safari makes multi-select difficult, upload them one by one. Commit the uploads to `main`.
6. Open **Settings → Pages** in the repository. For **Build and deployment**, choose **Deploy from a branch**. Pick `main` and `/(root)`, then Save.
7. After GitHub deploys the site, open the Pages URL it shows (typically `https://YOURNAME.github.io/my-sudoku/`) in **Safari**.
8. In Safari, choose **Share → Add to Home Screen**, enable **Open as Web App** if offered, and tap **Add**.
9. Open Sudoku from the new Home Screen icon. Once it has loaded and its assets are cached, the game should also work without internet.

If a GitHub menu is missing on iPhone, in Safari use **aA / Page Menu → Request Desktop Website**, or rotate the phone to landscape for the upload and Settings steps.

**Important:** The code is public in a public GitHub repository, but **your actual game progress stays in local storage on your own device**, not on GitHub. Deleting browser/website data or removing and reinstalling the Home Screen web app can erase local progress. Game data does not sync across devices.

## Computer alternative

Publish all six files at the root of any static HTTPS website (GitHub Pages or Cloudflare Pages). The site needs no npm, build process, database, or paid hosting.

For local browser testing you can also run `python3 -m http.server 8000` from this directory, then open `http://localhost:8000`.

## Optional customization

All styling is in `index.html` under `<style>`. For example, change `#2f79db` / `#2d78cb` to customize blue accent colors. Change `DIFFICULTIES` in the JavaScript to adjust approximate starting clue counts. When you update files in GitHub, also bump `CACHE_NAME` in `service-worker.js` to make offline updates reliable.

## Limitations

This is a browser-based app installed to the iPhone Home Screen, not an app distributed through Apple's App Store. Difficulty labels estimate difficulty using numbers of clues; the game does not yet implement technique-level grading. The hint button fills a correct cell rather than explaining a deduction. An offline game should be opened online at least once after install to populate the cache.
