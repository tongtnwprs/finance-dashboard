# Finance 2026 Interactive Dashboard

Static dashboard for GitHub Pages.

## Deploy

1. Push the repository containing `index.html` and this `dashboard/` folder to GitHub.
2. In GitHub, go to **Settings → Pages**.
3. Choose **Deploy from a branch** and set the source folder to the repository root (`/`).
4. Open the GitHub Pages URL. The root page redirects to `./dashboard/`.

## Connect Google Sheet

Publish the Google Sheet as CSV, then paste the CSV URL into the dashboard input.

Example URL shape:

```text
https://docs.google.com/spreadsheets/d/e/<PUBLISHED_ID>/pub?gid=<SHEET_GID>&single=true&output=csv
```

The dashboard is frontend-only. It can read public/published CSV data, validate it, visualize it, and let you test edits in the browser. It does not write back to Google Sheet unless a separate Apps Script/API layer is added later.
