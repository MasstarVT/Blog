---
title: Markdown kitchen sink (style test)
description: Every Markdown feature in one post, to check the blog styles. Drafts never appear on the live site.
pubDate: 2026-09-24
tags: [meta]
draft: true
---

This draft shows every element the blog styles. It only appears when running `npm run dev`.

## Headings

### Third level

#### Fourth level

## Text

Regular paragraph with **bold**, *italic*, ~~strikethrough~~, `inline code` and a [link](https://masstar.org).

> A blockquote — great for quoting chat or a friend's hot take.

---

## Lists

- Unordered item
- Another item
  - Nested item
1. Ordered item
2. Second item

- [x] Task done
- [ ] Task to do

## Code

```js
// Syntax highlighted code block
const live = await fetch('https://api.ivr.fi/v2/twitch/user?login=masstarvt').then((r) => r.json())
console.log(live[0].stream ? 'LIVE' : 'offline')
```

## Table

| Game | Hours | Verdict |
| ---- | ----: | ------- |
| ULTRAKILL | 120 | Peak |
| Spirit Derby | 12 | Chaos |

## Image

![MasstarVT avatar](/PFP.jpg)
