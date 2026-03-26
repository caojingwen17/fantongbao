# Design System Strategy: The Digital Hearth

## 1. Overview & Creative North Star
The "Digital Hearth" is the creative North Star for this design system. We are moving away from the "utility-first" coldness of standard recipe apps and moving toward an **Editorial Kitchen** aesthetic. The goal is to make the user feel like they are flipping through a high-end, bespoke cookbook rather than interacting with a database.

We break the "template" look by utilizing **Intentional Asymmetry**. For example, hero images of recipes should not always be centered; they should bleed off the edge of the screen or sit nested within organic, overlapping `surface-container` layers. We prioritize "breathing room" (whitespace) and tonal depth over rigid grid lines to foster a sense of calm and domestic warmth.

## 2. Colors & Surface Philosophy
The palette is inspired by the transition from raw ingredients to a finished meal.

*   **Primary (`#944a00`):** Represents the "Golden Hour" of baking and roasted textures. Used for high-intent actions.
*   **Secondary (`#1e6c26`):** Represents garden-fresh vitality. Used for health-centric callouts and "Freshness" indicators.
*   **Surface Hierarchy:** We utilize a "Paper on Table" metaphor.
    *   **The "No-Line" Rule:** 1px solid borders are strictly prohibited for sectioning. To separate a recipe's "Ingredients" from "Instructions," use a background shift from `surface` to `surface-container-low`.
    *   **Nesting:** A card (`surface-container-lowest`) should sit atop a section (`surface-container-low`), which sits atop the base (`surface`). This creates a natural, tactile depth without the clutter of lines.
    *   **The Glass & Gradient Rule:** For floating headers or navigation bars, use Glassmorphism. Apply `surface` at 80% opacity with a heavy `backdrop-blur`. For primary CTAs, use a subtle linear gradient from `primary` to `primary_container` to give the button a "sun-kissed" glow.

## 3. Typography: Editorial Clarity
We pair two distinct sans-serifs to balance personality with high-functioning utility.

*   **Display & Headlines (Plus Jakarta Sans):** This typeface features open apertures and a modern, friendly geometric soul. Use `display-lg` for recipe titles to create an authoritative, editorial feel. 
*   **Body & Labels (Be Vietnam Pro):** Chosen for its exceptional legibility at small scales. Use `body-md` for ingredient lists and `body-sm` for nutritional facts.
*   **Hierarchy Note:** High contrast between `headline-lg` and `body-md` is encouraged to create a clear "Entry Point" for the eye on crowded screens.

## 4. Elevation & Depth
In this system, light and shadow mimic a sunlit kitchen.

*   **The Layering Principle:** Depth is achieved by stacking. A "Shopping List" item that is being dragged should transition from `surface-container` to `surface-container-highest` to visually "lift" toward the user.
*   **Ambient Shadows:** For elevated elements like "Quick-Add" FABs, use a shadow with a 24px blur, 4% opacity, and a tint of `on-surface` (#1d1b1a). It should feel like a soft glow, not a harsh drop-shadow.
*   **The "Ghost Border" Fallback:** If a border is required for accessibility on form fields, use `outline-variant` at 20% opacity. 100% opacity borders are too "loud" for this domestic environment.

## 5. Components

### Cards & Lists
*   **Recipe Cards:** Use `roundedness-lg` (2rem). Overlap the recipe category chip (e.g., "Dinner") 50% over the image and 50% over the white space to break the container's boxiness.
*   **No Dividers:** In the "Ingredient Merging" list, separate items using `spacing-4` (1.4rem) of vertical whitespace. If grouping is needed, wrap the group in a `surface-container-low` block with `roundedness-md`.

### Buttons
*   **Primary:** High-gloss `primary` to `primary-container` gradient. `roundedness-full`.
*   **Secondary:** `secondary-container` background with `on-secondary-container` text. No border.
*   **Tertiary:** Text-only using `primary` color, reserved for low-priority actions like "Cancel" or "View More."

### Input Fields
*   **Search/Text Inputs:** Use `surface-container-highest`. Upon focus, the background should shift to `surface-container-lowest` with a "Ghost Border" of `primary` at 20% opacity.

### Custom Component: The "Step-Card"
*   For cooking steps, use a large-format card. The step number should be in `display-sm` at 10% opacity of `primary`, positioned in the top-right corner, acting as a background watermark for the instruction text.

## 6. Do’s and Don’ts

### Do:
*   **Do** use `spacing-8` and `spacing-10` to create "Editorial Moments" where an image or quote can breathe.
*   **Do** use `roundedness-xl` for large image containers to maintain the "Soft & Homey" promise.
*   **Do** use `secondary` (green) for all "Added to Cart" or "Recipe Complete" states to reinforce the feeling of fresh success.

### Don't:
*   **Don't** use pure black (#000000) for text. Always use `on-surface` (#1d1b1a) to keep the contrast soft.
*   **Don't** use 90-degree corners. Even "sharp" elements must have at least `roundedness-sm` (0.5rem).
*   **Don't** use "Zebra-striping" for lists. Use tonal shifts or whitespace instead.