# Add Multidimensional Table to Form Assistant

## Features
1.  **New Component**: Create `MultidimensionalTable.tsx` to handle the table UI and logic.
    -   **Table Structure**: Dynamic columns and rows.
    -   **Agent Integration**: Allow binding a column to an "Expert Agent" (from existing AI Volunteers).
    -   **Automation**: A "Run" button to simulate processing data row-by-row using the assigned agent.
    -   **Mock Interface**: A placeholder `runAgentTask` function to simulate the AI response (as requested, reserving the interface for future refinement).

2.  **Workspace Integration**:
    -   Update `components/AIAgentWorkspace.tsx` to render the `MultidimensionalTable` when the "Forms" (表单助手) room is active.
    -   Pass `teamMembers` prop to allow agent selection.

## Implementation Steps
1.  Create `components/AIAgentWorkspace/MultidimensionalTable.tsx`.
2.  Update `components/AIAgentWorkspace.tsx` to import and use the new component.
