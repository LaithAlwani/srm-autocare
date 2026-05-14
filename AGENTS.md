<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## JavaScript targets

This site ships **ES6+ / Baseline modern** JS only. The build is configured for:

- `tsconfig.json` → `"target": "ES2022"` (TypeScript emits modern output)
- `package.json` → `browserslist` pins Chrome 92+, Edge 92+, Firefox 90+, Safari 15.4+

**Always use modern JS APIs directly** — `Array.prototype.at`, `flat`, `flatMap`, `Object.fromEntries`, `Object.hasOwn`, `String.prototype.trimEnd/trimStart`, optional chaining, nullish coalescing, top-level await in server code, etc.

**Never reach for polyfills or `core-js`.** If you do need to support an older browser, raise it as a question before adding any polyfill — don't silently change the build target. Wasted polyfill bytes were measured by Lighthouse at ~14 KB before we tightened this; keep them out.

Reference: https://web.dev/articles/publish-modern-javascript

## Accessibility — images & videos

**Every `<Image>` and `<img>` must have an `alt` attribute.** Three cases:

- **Meaningful image** (logo, illustration, hero photo): write a short description of what it shows. Example: `alt="Mirror-finish black sports car parked in the SRM studio"`.
- **Decorative-only** (background pattern, divider): pass `alt=""`. Empty string is a deliberate signal to screen readers that the image conveys no information — *don't* omit the attribute.
- **Image inside an `<a>` or `<button>` that already has a label** (icon + adjacent text, or `aria-label` on the parent): pass `alt=""` so screen readers don't double-announce.

**Every `<video>` must have an `aria-label`** that describes the footage. `<video>` does not support `alt`. If the video is purely decorative (e.g. an autoplaying background loop) and there's foreground text describing the section, mark it `aria-hidden={true}` instead.

This project's `HeroMedia` component enforces both rules — pass `alt="…"` and it lands on the correct attribute for the media type.
