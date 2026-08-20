# Design QA · WIWO.Nodes logo

## Evidence

- Source visual truth: `C:\Users\Lenovo\Desktop\14-08\Slide - Center.png`
- Browser-rendered implementation: `C:\Users\Lenovo\AppData\Local\Temp\wiwo-nodes-implementation-final.png`
- Normalized focused comparison: `C:\Users\Lenovo\AppData\Local\Temp\wiwo-nodes-logo-comparison-normalized.png`
- Viewport: 1280 × 720 CSS px, device pixel ratio 1.
- Source pixels: 11397 × 2180 with alpha channel.
- Implementation screenshot: 1280 × 720 px; rendered logo slot: 156 × 34 CSS px.
- State: Inicio, API real not configured, owner-safe blocked state.

## Full-view comparison evidence

The supplied WIWO.Nodes lockup is centered in the persistent top bar, uses the original transparent PNG, preserves its aspect ratio, and remains visually separated from the page heading and action icons. The blue matches the existing application palette and no orange treatment was introduced.

## Focused region comparison evidence

The normalized side-by-side crop confirms the exact wordmark, capitalization, dot placement, blue color, and proportions. The browser-rendered raster is slightly softer at 156 px than the high-resolution source; this is expected downsampling and does not change legibility or identity.

## Required fidelity surfaces

- Fonts and typography: logo typography is preserved inside the supplied raster; no substitute font was used. Page typography was not changed.
- Spacing and layout rhythm: centered 156 × 34 slot aligns vertically within the 68 px top bar and does not overlap adjacent content.
- Colors and visual tokens: source blue is preserved; surrounding UI remains in the approved blue palette.
- Image quality and asset fidelity: original 32-bit PNG is used directly with `object-fit: contain`; no SVG, CSS drawing, text recreation, stretching, or background halo.
- Copy and content: visible product name and document title now use `WIWO.Nodes`; SAC-specific page copy is unchanged.

## Findings

- No actionable P0, P1, or P2 differences.
- P3: the wordmark is necessarily downsampled in the compact desktop header; the result remains clear at the target viewport.

## Interaction and console checks

- Navigation tested from Inicio to Bandeja SAC and back to Inicio.
- Product title verified as `Centro de operaciones SAC | WIWO.Nodes`.
- Console errors checked after navigation: none.

## Comparison history

- Pass 1: no P0/P1/P2 findings; no visual correction loop required.

## Implementation checklist

- [x] Use the supplied WIWO.Nodes asset.
- [x] Replace the centered Flow Studio wordmark.
- [x] Update visible and browser product naming.
- [x] Preserve responsive behavior and existing SAC functionality.

final result: passed

---

# Design QA · Comentarios agrupados por publicación

## Evidence

- Source visual truth: `C:\Users\Lenovo\AppData\Local\Temp\codex-clipboard-b267bcdb-3b01-44b1-b7b8-a1d54dfa3b8e.png`
- Browser-rendered implementation: `artifacts/manual-post-comments-design-qa/implementation-final-1280x720.png`
- Normalized full-view comparison: `artifacts/manual-post-comments-design-qa/source-vs-final-normalized-1280x1440.png`
- Focused queue/composer comparison: `artifacts/manual-post-comments-design-qa/focused-reference-vs-final-915x1012.png`
- Browser viewport: 1280 × 720 CSS px; device pixel ratio 1.
- Source pixels: 1906 × 1059. The source was proportionally contained inside 1280 × 720 with a white background; it was not stretched or cropped.
- Implementation pixels: 1280 × 720 at the same density as its CSS viewport.
- State: Converse → Instagram · Comentarios → newest available post card → 70 exact open inbound comments → oldest comment selected for reply.

## Full-view comparison evidence

- The final screen retains the reference's dense SAC structure: persistent navigation, account selector, horizontal channel tabs, a publication queue, a central working area and a separate context rail.
- The requested product change is intentional: the source shows a person/message thread, while the implementation replaces that central history with the selected post's exact unanswered-comment queue.
- The indigo/blue WIWO.Nodes tokens, white working surfaces, thin dividers, compact controls and independent pane scrolling remain consistent with the supplied interface.
- At the 1280 px QA viewport the centered wordmark is deliberately hidden so it cannot collide with the page title; it remains available at wide desktop sizes.

## Focused region comparison evidence

- Post cards preserve the reference hierarchy of image, title, latest activity and pending count, while adding total comments and participant count.
- Selecting a publication visibly highlights it. The oldest pending comment is also visibly selected, and the composer repeats the exact target in a fixed `Respondiendo a…` citation.
- The context fallback is compact when Metricool supplies neither image nor link; it never fabricates a post URL or preview.
- The queue has no horizontal overflow at 1280 px (`clientWidth` equals `scrollWidth`), and the document itself has no horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: Inter and the existing WIWO.Nodes hierarchy are preserved; exact-comment metadata was raised to 10–12 px with darker tokens for operational legibility.
- Spacing and layout rhythm: the three-pane proportions follow the source on wide screens and collapse to a master/detail flow below 860 px. Cards, controls and status pills reuse the existing radii and divider rhythm.
- Colors and visual tokens: only the approved indigo, blue, slate, green and semantic warning colors are used; no orange treatment was introduced.
- Image quality and asset fidelity: available provider thumbnails are rendered as HTTPS images. Missing images use the existing Phosphor icon and an explicit unavailable state rather than fake imagery.
- Copy and content: `Publicado` is shown only with a real provider timestamp. Historical posts without it are explicitly labeled `Actividad` and the queue says `fecha faltante: orden por actividad`.
- Accessibility: channel tabs retain arrow/Home/End navigation; comments are a semantic ordered list of native buttons with `aria-current`; the selected target is repeated next to the composer; mobile has an explicit `Volver` control.

## Findings

- No actionable P0, P1 or P2 findings remain for the requested flow.
- P3/external-data constraint: existing historical Metricool snapshots do not contain `publishedAt`, so they use the declared activity fallback until a future read sync supplies a real publication timestamp.

## Primary interactions and console checks

- Opened Gestión manual, selected Instagram comments, opened a real post, verified all 70 open inbound comments, and selected an exact comment without submitting any form.
- Verified the first/oldest comment is the active target and the composer citation matches it.
- Verified no page or contact-list horizontal overflow at 1280 × 720.
- Desktop and mobile automated flows passed with mocked reply actions; no real message was sent.
- Browser console warnings/errors after the final interaction: 0.

## Comparison history

- Pass 1 found horizontal overflow, misleading date/order copy and a large empty post-preview fallback; these were corrected.
- Pass 2 found a P0 targeting mismatch: the composer could point to a prioritized comment outside the visible oldest-first queue. The early target opening was removed, the oldest loaded comment is now selected, the composer cites it and send is blocked when that ID is no longer open.
- Pass 3 confirmed the fixes in the browser-rendered final screenshot with no remaining P0/P1/P2 issue.

## Implementation checklist

- [x] Group comment work by exact account, platform and post.
- [x] Sort by real publication date newest-first when available.
- [x] Use an explicit activity fallback when the provider date is absent.
- [x] Load every unanswered inbound comment for the selected post oldest-first.
- [x] Bind drafts and sends to the exact selected interaction ID/version.
- [x] Preserve three-pane desktop efficiency and mobile master/detail behavior.
- [x] Keep the workflow manual-only and avoid Metricool mutations during QA.

final result: passed

---

# Design QA · Gestión manual por cuenta

## Evidence

- Source visual truth: `C:\Users\Lenovo\Downloads\Captura de pantalla 2026-08-17 a la(s) 5.39.23 p.m..png`
- Browser-rendered implementation: `artifacts/manual-inbox-design-qa/implementation-final-1339x861.png`
- Same-input comparison: `artifacts/manual-inbox-design-qa/reference-vs-implementation.png`
- Viewport: 1339 × 861 CSS px, matching the source screenshot exactly.
- State: Converse → Instagram · Comentarios → first publication → exact inbound comment selected.

## Visual comparison

- Preserved the reference's efficient three-column structure: publication/contact queue, exact conversation and reply workspace, and publication/account context.
- Matched the dense navigation, horizontal surface tabs, independent scrolling regions, selected-row treatment, compact composer and always-visible action row.
- Adapted the visual language to WIWO.Nodes with the existing blue/indigo palette; no orange styling was introduced.
- When Metricool does not supply a thumbnail or permalink, the context column shows an explicit unavailable state instead of fabricating a preview or URL.

## Interaction and safety checks

- Account selection, surface tabs, publication selection and exact-comment selection were exercised in the in-app browser.
- Arrow-key navigation moves between surface tabs; Home/End support is implemented in the same control.
- Browser viewport had no horizontal or vertical page overflow at 1339 × 861; internal columns retain their own scrolling.
- Browser console warnings/errors: 0.
- The manual send control was inspected but never activated; no real reply or Metricool mutation was performed during QA.
- Focused desktop and responsive mobile E2E checks passed with mocked network actions.

## Verification

- TypeScript client and server check: passed.
- Production client/API build: passed in Docker.
- Docker API, worker and PostgreSQL: healthy.
- Server/Sites/migration suite: 164 + 6 + 17 checks passed.
- Security audit: 0 vulnerabilities.
- Rollback checkpoint: `checkpoint/before-account-manual-inbox-20260817` → `e9ee6301049c59e53fdf96a20dd75bfbf49197d9`.

final result: passed
