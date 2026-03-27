# Design System Specification: The Precision Architect

## 1. Overview & Creative North Star
The "Precision Architect" is the creative North Star for this design system. In the world of developer tools, "clean" usually results in "sterile." We are breaking that mold. Our goal is to create an environment that feels like a high-end physical architectural studio: expansive, precisely layered, and intellectually quiet.

We achieve this through **"Tonal Density."** Instead of using heavy lines to separate complex data, we use a sophisticated hierarchy of surface washes and "Inter" typography. The interface should feel like a single, continuous sheet of intelligent paper where information isn't "boxed in" but rather "settled into" its place.

## 2. Colors & Surface Philosophy
The palette is rooted in a deep, authoritative blue (`primary: #003d9b`) set against an ethereal, cool-tinted white (`background: #faf9ff`).

### The "No-Line" Rule
Standard 1px solid borders are strictly prohibited for layout sectioning. They create visual noise in high-density developer environments. 
- **Definition through Contrast:** Separate the Inspector panel from the Canvas by placing a `surface_container_low` panel against the `surface` background.
- **The Tonal Transition:** Use `surface_container` for sidebar backgrounds to naturally recede, allowing the central workspace to feel "bright" and focused.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of materials. 
1.  **Base Layer:** `surface` (#faf9ff) - The infinite canvas.
2.  **Structural Panels:** `surface_container_low` (#f1f3ff) - Used for fixed sidebars (Inspector, Chat).
3.  **Interactive Elements:** `surface_container_lowest` (#ffffff) - Used for Cards and Nodes to make them "pop" forward.
4.  **Persistent Overlays:** `surface_bright` - Used for floating toolbars.

### The Glass & Gradient Rule
To prevent the tool from feeling like a flat template, apply a `backdrop-blur` of 12px to floating menus using a 70% opacity version of `surface_container_highest`. For primary CTAs, use a subtle linear gradient from `primary` (#003d9b) to `primary_container` (#0052cc) at a 135-degree angle to provide a "jewel-like" depth.

## 3. Typography
We utilize **Inter** for its mathematical precision and exceptional readability at small scales.

*   **The Editorial Scale:** Use `display-sm` for empty state headers to create a "poster" feel, contrasting heavily with the high-density `label-sm` code snippets.
*   **Hierarchy through Weight, not just Size:** Use `label-md` in Medium weight (500) for property names in the Inspector, paired with `body-sm` in Regular (400) for the values.
*   **Functional Intent:** All technical metadata (IDs, timestamps, hex codes) must use `label-sm` to maximize information density without overwhelming the user.

## 4. Elevation & Depth
We eschew traditional drop shadows for **Ambient Occlusion**.

*   **The Layering Principle:** Depth is communicated via the `surface_container` tiers. A `surface_container_lowest` node sitting on a `surface_container_high` group area creates a natural perceived lift.
*   **Ambient Shadows:** For floating modals, use a 3-layer shadow:
    *   `0 4px 12px rgba(5, 26, 62, 0.04)`
    *   `0 12px 24px rgba(5, 26, 62, 0.06)`
*   **The Ghost Border:** For accessibility in node-based layouts, use a 1px border with `outline_variant` (#c3c6d6) at **20% opacity**. It should be felt, not seen.

## 5. Components

### Nodes (The Core Unit)
Nodes must be high-density containers using the `xl` (0.75rem) corner radius.
*   **Default State:** Background `surface_container_lowest`, 20% opacity `outline_variant` border.
*   **Active State:** Background `surface_container_lowest`. Increase border opacity to 100% using `primary_container` (#0052cc). Add a 2px "Focus Ring" using `primary_fixed` at 50% opacity.
*   **Done State:** Background `surface_container_low`. Typography shifts to `on_surface_variant`. A small `tertiary` (#004b59) icon indicator in the top right.

### Buttons
*   **Primary:** Gradient fill (`primary` to `primary_container`). `on_primary` text. Radius `md`.
*   **Secondary:** No fill. `ghost border` (20% `outline`). Text in `primary`.
*   **Ghost (Tertiary):** No fill, no border. Text in `on_secondary_container`. Use for low-priority Inspector actions.

### Inspector Panels & Chat
*   **The Content Rule:** Forbid divider lines between property rows. Use `spacing.2` (0.4rem) of vertical padding and alternating `surface_container_low` and `surface` backgrounds for zebra-striping if high-density clarity is lost.
*   **Input Fields:** Use `surface_container_highest` for the input background with a bottom-only `outline` at 40% opacity. This creates a "form" feel without the "box" clutter.

### Additional Components: The "Breadcrumb Trace"
For complex technical tools, use a vertical breadcrumb in the Inspector using `label-sm` and `secondary` color tokens to show the node's lineage in the data tree.

## 6. Do's and Don'ts

### Do
*   **DO** use whitespace as a separator. Use `spacing.6` (1.3rem) between major logical groups.
*   **DO** use `tertiary` (#004b59) for "Success" or "Complete" states instead of a generic bright green; it maintains the sophisticated blue-tinted harmony.
*   **DO** nest containers using the hierarchy: `surface` -> `surface_container_low` -> `surface_container_lowest`.

### Don't
*   **DON'T** use 100% black text. Always use `on_surface` (#051a3e) to maintain the "ink on paper" aesthetic.
*   **DON'T** use sharp 0px corners. Even the most technical tool needs the "softness" of our `sm` (0.125rem) or `DEFAULT` (0.25rem) radius to feel modern.
*   **DON'T** use standard tooltips. Use a `surface_container_highest` background with a backdrop blur for an integrated, premium feel.