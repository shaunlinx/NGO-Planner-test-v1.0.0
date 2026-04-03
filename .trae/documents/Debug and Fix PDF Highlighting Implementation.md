I will fix the issue where PDF text highlighting is not appearing by implementing a robust "overlay layer" strategy, as the previous `customTextRenderer` approach in `react-pdf` is unreliable for styling and events.

1.  **Diagnose**: The current `customTextRenderer` implementation relies on exact string matching within individual text spans. PDF text is often fragmented (e.g., "Hello" might be split into "Hel" and "lo"), causing matches to fail. Also, `react-pdf`'s text layer is finicky with DOM manipulation.

2.  **Solution: Dedicated Highlight Overlay**:
    *   Instead of modifying the text layer, I will create a separate absolute-positioned `div` layer *on top* of the PDF page.
    *   I will use the `react-pdf` **`customTextRenderer` purely to capture text coordinates** (using a hidden side-effect or a more reliable search approach if coordinates are available, but `react-pdf` makes coordinate extraction hard without a custom render).
    *   **Better Approach for Stability**: Since coordinate extraction is complex, I will refine the `customTextRenderer` to be more aggressive and correct. I will **normalize** the text matching logic to handle whitespace and fragmentation better.
    *   **Alternative (Plan B)**: If `customTextRenderer` remains flaky, I will switch to using the standard browser `Selection` API to highlight: when a user selects text, we save the range. But for *restoring* highlights from saved data, we need robust matching.
    *   **Refined Plan**: I will stick to `customTextRenderer` but fix the matching logic. I will also add `console.log` debugging to see what `textItem.str` actually contains to verify why matches are failing.

3.  **Immediate Fix**:
    *   The previous code `textItem.str.includes(h.text)` fails if `h.text` spans multiple text items.
    *   I will implement a **"Global Text Normalization"** strategy:
        *   This is too complex for a quick fix.
    *   **Pragmatic Fix**: I will relax the matching condition. I will check if `h.text` *contains* `textItem.str` (reverse check) and is long enough to be significant, or if there is a partial overlap.
    *   I will also ensure the `mark` tag has `z-index` and correct pointer events to be clickable.

4.  **Verification**: I'll add logging to the renderer to confirm it's actually running and receiving highlights.