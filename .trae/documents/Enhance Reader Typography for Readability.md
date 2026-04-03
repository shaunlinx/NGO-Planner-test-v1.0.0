I will enhance the `UniversalReader` typography and styling to address the readability issues (lack of indentation, unclear headers).

1.  **Tailwind Typography Customization**:
    *   I will modify `UniversalReader.tsx` to apply specific Tailwind classes that enforce **first-line indentation** for paragraphs (`indent-8` or `text-indent: 2em`).
    *   I will strengthen the **Header Styling** (`h1`, `h2`, `h3`...) by increasing font weights, adding bottom borders, and adjusting margins to make the hierarchy visually distinct.

2.  **CSS Injection**:
    *   Since `prose` (Tailwind Typography) sometimes overrides specific styles, I might need to inject a small style block or use arbitrary values to ensure `text-indent` works correctly on `<p>` tags but not on headers or list items.
    *   I will also add `text-justify` to ensure clean blocks of text.

3.  **Markdown Rendering Config**:
    *   I will configure `react-markdown` components mapping to explicitly style headers (`h1`-`h6`) with distinct colors and sizes (e.g., H1 centered/large, H2 with left border).

This will transform the "wall of text" into a structured, professional document layout.