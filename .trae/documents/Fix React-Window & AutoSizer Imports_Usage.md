I will fix the white screen issue by correctly importing and using the virtualized list components, which have API differences in the installed versions (`react-window` v2.x and `react-virtualized-auto-sizer` v2.x).

1.  **Update Imports**:
    *   Change `import AutoSizer` to `import { AutoSizer }` (Named export).
    *   Change `import { FixedSizeList as List }` to `import { List }` (API change in v2).

2.  **Update Component Usage**:
    *   Update `<List>` to use the `rowComponent={Row}` prop instead of passing `Row` as children (API change in v2).

3.  **Clean up**: Remove `@ts-ignore` directives as the imports will now be correct.