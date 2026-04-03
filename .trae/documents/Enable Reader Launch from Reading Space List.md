I have identified the missing functionality in the "Reading Space". The `ReadingProjectList` component currently only displays the reading history but lacks the ability to re-open the reader or initiate a new reading session for an existing file. This prevents the user from continuing their reading, taking notes, or generating cards as requested.

Here is the plan to fix this:

1.  **Enhance `ReadingProjectList` Functionality**:
    *   Add an `onOpenReader` prop to the component.
    *   In the project details view (when a project is selected), make the document list items clickable or add a "Continue Reading" (继续阅读) button for each session.
    *   When clicked, invoke `onOpenReader` with the file information (path, name) and the project purpose.

2.  **Integrate with `KnowledgeBase`**:
    *   In `KnowledgeBase.tsx`, update the `<ReadingProjectList />` usage to pass the `onOpenReader` callback.
    *   The callback should set the `readingFile` and `readingPurpose` states, which will trigger the `ReaderLayout` modal to open (using the existing logic I just added).

3.  **Verify Reader Interaction**:
    *   I have already verified that `PDFViewer.tsx` and `DocxViewer.tsx` implement `onMouseUp` to capture text selection and trigger the `onTextSelect` callback.
    *   This confirms that once the reader is opened, the "note taking" and "card generation" (via text selection) should work as intended.

4.  **No Changes Needed for Viewers**: The viewers are already set up correctly to handle selection. The issue is purely the entry point from the Reading Space list.

By implementing these changes, users will be able to navigate to the "Reading Space" tab, select a project, and click on any document to resume their deep reading session, where they can then select text to create knowledge cards.

I will proceed with modifying `ReadingProjectList.tsx` and `KnowledgeBase.tsx` now.