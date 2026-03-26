# Design System Strategy: The Culinary Playground

## 1. Overview & Creative North Star
This design system is built to transform the utility of cooking into an act of family play. Our Creative North Star is **"The Bubbly Kitchen"**—a digital environment that feels less like a static recipe book and more like a living, breathing culinary workshop. 

To move beyond the "standard app" aesthetic, we embrace **Intentional Asymmetry**. We break the rigid grid by allowing organic, hand-drawn shapes to bleed across container boundaries and using overlapping elements that mimic ingredients scattered on a countertop. This system rejects clinical precision in favor of warmth, energy, and tactile depth.

---

## 2. Colors & Surface Philosophy
The palette is a high-energy transition from sunrise oranges to fresh garden greens. However, sophistication is found in the *hierarchy* of these colors, not just their vibrance.

### The "No-Line" Rule
**Borders are strictly prohibited for sectioning.** To separate a recipe card from a background or a category pill from a header, use background color shifts only. 
*   **Example:** Place a `surface-container-lowest` card (#ffffff) on top of a `surface-container-low` (#ffeedc) background. The transition should be felt, not seen as a hard edge.

### Surface Hierarchy & Nesting
Treat the UI as a series of soft, pillowy layers. 
*   **Base Level:** `surface` (#fff5ec) for global backgrounds.
*   **Secondary Level:** `surface-container` (#ffe4c4) for grouping related content blocks.
*   **Interactive Level:** `surface-container-highest` (#ffd6a2) for active states or deeply nested interactive elements.

### The Glass & Gradient Rule
To prevent the "flat" look common in budget apps, main CTAs and floating navigation elements should utilize:
*   **Signature Textures:** A linear gradient from `primary` (#874e00) to `primary-container` (#ff9800) at a 135° angle to create a "sun-drenched" glow.
*   **Glassmorphism:** Use `surface-container-lowest` at 80% opacity with a `20px` backdrop blur for floating navigation bars or modal overlays, allowing the vibrant food photography and organic shapes to peek through.

---

## 3. Typography
We use **Plus Jakarta Sans** exclusively. Its geometric foundations provide modern clarity, while its open apertures feel inherently friendly.

*   **Display (lg/md):** Use for "Hero" moments like recipe titles. The tight tracking and large scale convey energy.
*   **Headline (sm/md):** Use for section headers. Ensure `on-surface` (#432900) is used to maintain high legibility against warm backgrounds.
*   **Body (lg/md):** Reserved for instructions and descriptions. We prioritize line height (1.6x) to ensure recipes are readable from a distance on a kitchen counter.
*   **Label (md/sm):** Used for metadata like "Prep Time" or "Difficulty." These should often appear in `secondary` (#665c00) to distinguish them from narrative text.

---

## 4. Elevation & Depth
Depth in this system is a result of **Tonal Layering**, not structural engineering.

*   **The Layering Principle:** Avoid shadows for static elements. A `surface-container-highest` element sitting on a `surface` background provides enough contrast to imply depth without visual clutter.
*   **Ambient Shadows:** For "floating" action buttons (FABs) or active cards, use an ultra-diffused shadow: `Offset: 0, 12px; Blur: 24px; Color: rgba(67, 41, 0, 0.08)`. Note that the shadow color is a tinted version of `on-surface`, never pure black.
*   **The Ghost Border:** If a form field requires a boundary, use the `outline-variant` (#d0a66d) at **15% opacity**. It should be a whisper of a line, just enough to guide the eye.

---

## 5. Components

### Buttons
*   **Primary:** `full` roundness. Background: `primary` gradient. Label: `on-primary`. These are our "Call to Joy" triggers.
*   **Secondary:** `full` roundness. Background: `secondary-container` (#f9e534). For less urgent actions like "Add to Plan."
*   **Tertiary:** No background. Uses `primary` text with an icon. For "Cancel" or "Back" actions.

### Cards (The "Ingredient" Card)
Cards must use `xl` (3rem) or `lg` (2rem) corner radius. **Never use dividers.** Content within the card is separated by `spacing-4` (1.4rem) or a shift to `surface-container-low`.

### Expressive Icons & Badges
*   **Badges:** Use `tertiary` (#006b1b) with `on-tertiary` text for positive indicators (e.g., "Healthy," "Quick"). Use `full` roundness.
*   **Input Fields:** Use `surface-container-lowest` as the field base with `DEFAULT` (1rem) roundness. The focus state is indicated by a 2px `primary` glow rather than a solid border.

### Contextual Components
*   **The "Step-by-Step" Progress Bubbles:** Large, circular indicators using `secondary-fixed` (#f9e534) for the active step to mimic a boiling pot or a rising timer.
*   **Organic Shape Mask:** Photos of food should not be square; they should be masked into "blob" shapes or use `xl` corner radiuses to maintain the "bubbly" atmosphere.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use overlapping elements. A sprig of mint (illustration) should overlap the edge of a recipe card.
*   **Do** use high-contrast typography scales. A `display-lg` title next to a `body-md` description creates a professional, editorial rhythm.
*   **Do** prioritize whitespace. Use `spacing-12` (4rem) between major sections to let the design breathe.

### Don't
*   **Don't** use 1px solid lines or dividers. They kill the "soft and approachable" energy.
*   **Don't** use pure black (#000000) for text or shadows. Use `on-surface` (#432900) to keep the warmth.
*   **Don't** use sharp corners. Anything less than `sm` (0.5rem) roundness will feel "too corporate" for this experience.