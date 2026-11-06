# SENRO studio — Flow with intention

## Visual direction

Original procedural violet flow gate, upper-left ambient light, navy glass surfaces and crisp sans-serif typography. The gate suggests deliberate routing; it does not visualize live network traffic. No third-party art or video was copied into the application.

The background has a pause/play control, respects reduced-motion preferences, caps pixel density and frame rate, and stops animating when hidden or outside the viewport. Framer Motion handles navigation, inline rule expansion, result reveals, dialogs and saved-card hover states.

## Working changes

- Sentence-based conditions with editable values and inline forms. Invalid inputs cannot replace the draft. All enabled limits must pass; unsupported OR/NOT controls are absent.
- Named saved configurations in a device-local rule library. Preview limits before loading; loading increments the current draft revision and clears previous checks/reviews. Saved copies are not on-chain activation.
- Activity filters distinguish local checks from mainnet venue simulations. Local entries expose scenario reasons and the recorded policy fingerprint; historical venue entries expose simulation metadata without presenting an executable review.
- Trading release configuration remains disabled. No mainnet program was deployed, trade signed or funds spent during this change.

## Verification

70 JavaScript tests pass, including four persistence checks covering corruption, invalid limits, bounded storage, excluded fields and quota failure. Production build and Worker artifact checks pass. The previously recorded 21 Rust checks are unchanged; this visual/persistence change did not rebuild the guard or rewrite historical runtime evidence.

Browser QA exercised inline save and invalid-input rejection, saving and inspecting a named copy, loading it into Studio with a new revision, running local scenarios, viewing activity details, filtering to an empty mainnet list and pausing the animation. Responsive CSS includes 1050/760/480 pixel breakpoints; a real mobile device and actual wallet extension remain untested.

The ChatGPT Site and the user's Netlify deployment are separate. Publishing this Site does not establish that the Netlify URL has updated.


## Icon and interaction polish — 6 November 2026

Simplified the shared icons into a consistent duotone family, with clearer token, preview, limit, volume, cooldown and balance symbols. Buttons now use a restrained glass highlight, edge glow and lift on pointer hover, with press and focus feedback. Reduced-motion preferences disable the moving sheen. Trading behavior is unchanged.

Validation: Netlify build and artifact checks passed; all 73 JavaScript tests passed. Desktop browser review confirmed the icons and computed hover transitions. Screenshot: `docs/icons-hover-review.jpg`.
