# MasstarVT — Blog & Stream Hub

Source for **[blog.masstar.org](https://blog.masstar.org)**: a blog plus everything MasstarVT in one place, including live status, stream schedule, VODs and clips, X, Bluesky and Discord. It uses the same red/black look as [masstar.org](https://masstar.org).

It's a static [Astro](https://astro.build) site hosted on GitHub Pages. A GitHub Actions workflow fetches fresh social data about every 30 minutes and redeploys when something changed. The live badge, Discord counts, Bluesky feed and schedule also refresh in the visitor's browser.

## Writing a post

1. Create a file in `src/content/posts/`, for example `src/content/posts/my-first-stream-recap.md`. The shortcut `npm run new -- "My first stream recap" --tags recap,ultrakill` does this for you.
2. Start the file with this frontmatter:

   ```md
   ---
   title: My first stream recap
   description: One or two sentences shown on cards, in search results and in link previews.
   pubDate: 2026-09-26
   tags: [recap, ultrakill]
   # optional:
   # updatedDate: 2026-09-27
   # cover: ../../assets/posts/my-first-stream-recap/cover.jpg
   # coverAlt: What the cover image shows
   # vod: https://www.twitch.tv/videos/123456789
   # draft: true
   ---

   Write the post in Markdown here…
   ```

3. Commit and push to `main`. The site rebuilds in about a minute.

**Drafts:**
- `draft: true` hides a post from the live site. It still shows up in `npm run dev`.
- The repo is public, so drafts are visible on GitHub. Keep anything private in the git-ignored `drafts/` folder.

**Scheduled posts:** a post with a future `pubDate` stays hidden until that date. The next scheduled rebuild after the date publishes it automatically.

**Images:**
- Put a post's images next to each other in `src/assets/posts/<slug>/` and reference them with relative paths.
- Anything in `public/` is served as-is. For example, `public/img/foo.png` becomes `/img/foo.png`.

## Changing handles, links and sections

Everything lives in **`src/config/site.mjs`**. That includes handles, IDs, link cards, hero text and feature flags.

- **YouTube:** set `youtube.channelId` to the `UC…` channel ID. The section and the build-time feed turn on automatically.
- **TikTok:** set `tiktok.handle` (without the `@`).
- **X profile timeline:** `x.timelineEmbed` turns X's official timeline widget on or off. It is flaky for logged-out visitors, and the site falls back automatically when it doesn't load.
- **Featured X posts:** paste post URLs into `src/data/x-posts.json`. Deleted posts are dropped at build time.

## Data sources

| What | Where it comes from | Needs a secret? |
|---|---|---|
| Live status | IVR → shields.io → DecAPI, polled in the browser | no |
| Profile, followers, last stream | IVR (at build time) | no |
| Schedule | Twitch Helix (build), or Twitch's public iCal (build and browser) | Helix: `TWITCH_CLIENT_ID`/`SECRET` |
| VODs and clips | Twitch Helix (build) | `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` |
| Discord card | Public invite endpoint (build and browser) | no |
| Bluesky feed | Public Bluesky API (build and browser) | no |
| X posts | Curated list checked with X's oEmbed; optional paid X API (about $0.15/month) | optional `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
| YouTube | Channel RSS (build) | no (optional `YOUTUBE_API_KEY`) |

If a source fails, the build reuses the last deployed copy from `https://blog.masstar.org/data/<name>.json`. A broken API never breaks the site.

## Local development

Requires Node 24.

```bash
npm install
npm run dev        # http://localhost:4321 (fetches data once if src/data/generated/ is missing)
npm run fetch      # re-fetch social data now (reads .env if present — see .env.example)
npm test           # unit tests for the data layer
npm run build && npm run preview   # production build on http://localhost:4322
npm run check      # astro type/content check
```

Dev-only switches for the live panel: `/?mock=live`, `/?mock=offline`, `/?poll=5000`.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` runs on every push to `main`, on manual **Run workflow**, and on a schedule at :17 and :47 past each hour. Each run:

1. Runs the tests.
2. Fetches data. This is the only step that sees secrets.
3. Builds the site and deploys it with `actions/deploy-pages`.

On scheduled runs the deploy is skipped when nothing changed.

One-time setup (already done for this repo):

- **Settings → Pages → Source:** GitHub Actions.
- **Settings → Pages → Custom domain:** `blog.masstar.org`, with **Enforce HTTPS** on.
- **Cloudflare DNS:** `CNAME blog → masstarvt.github.io`, **DNS only** (grey cloud). The domain is verified under the GitHub account's Pages settings.
- **Settings → Secrets and variables → Actions:** `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, plus the optional X/YouTube keys.

**If the schedule stops:** GitHub disables scheduled workflows after 60 days without a commit. Each new post counts as a commit. If it happens, re-enable it under **Actions → Build & deploy → Enable workflow**, or run:

```bash
gh workflow enable deploy.yml
```
