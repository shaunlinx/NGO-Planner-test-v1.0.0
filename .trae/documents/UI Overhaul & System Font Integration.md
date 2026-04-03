I will proceed with the UI overhaul and font feature implementation as follows:

### 1. Performance Assurance
- **Conclusion**: Using system fonts **will NOT** increase resource usage. In fact, it is more efficient than loading web fonts because it uses locally available resources directly via the browser's rendering engine.

### 2. UI Redesign (`OptimizationPanel`)
I will completely rewrite the `OptimizationPanel` component to replace the current "ugly" interface with a modern, polished design:
- **Presets Section**: Transform into a **Grid Layout** with large, clickable cards. Each card will feature an icon, title, and description, with clear visual cues for the selected state (border, shadow, color).
- **Font Selection**:
    - Replace the simple generic select box with a **Smart Font Selector**.
    - **Preset List**: Include popular system fonts for both Windows and macOS (e.g., "Microsoft YaHei", "PingFang SC", "SimSun", "Times New Roman").
    - **"WYSIWYG" Dropdown**: Render font options using the font itself so users can preview the style immediately.
- **Typography Controls**:
    - Group Font Size, Line Height, and Letter Spacing into a clean **Control Cluster**.
    - Enhance sliders with visual labels and better track styling.
- **Template Management**:
    - Move to a dedicated footer section.
    - Style saved templates as "Capsule Tags" for better organization.
- **Preview Area**:
    - Style it to look like a "Mini Document" with proper padding, shadow, and background, strictly reflecting the current settings.

### 3. Implementation Details
- **Codebase**: `components/KnowledgeBase.tsx`
- **Data Structure**: Update `OptimizationConfig` to handle specific font family strings.
- **Constants**: Define a robust `SYSTEM_FONTS` array containing cross-platform standard fonts.

I will now verify the file content one last time and then apply these changes.