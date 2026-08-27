# Production brand

The public lockup is the compact stacked wordmark (`THE` over `Valley Desk`) beside the locked A Fold mark. The fold opens once per browser session for 800ms, then remains completely still. It uses the existing planes only: no glow, sheen, breathing loop, filters, layout shift, or frame-by-frame React state. Reduced-motion users see the resting mark immediately.

## Type decision

Production remains on IBM Plex Sans/Serif, including a real Sans 700. The supplied Valley Sans/Serif prototype is not production-ready:

- it contains 400/500/600 only while the site uses 700 extensively;
- its TrueType hint programs were stripped, with no verified Windows/low-density rendering;
- its documented 1.8% width expansion changes headline and navigation wrapping;
- its build depends on an unpinned external source tree; and
- the unverified trademark metadata needs review.

Do not self-host Valley fonts until a reproducible, licensed, hinted build includes the required weights and passes desktop/mobile visual-regression testing.
