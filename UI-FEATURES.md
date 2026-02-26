# Data Virtualization Wizard - UI Features

This document describes the multiple UI entry points available for launching the Data Virtualization Wizard.

## Overview

The extension now provides three convenient ways to access the wizard, making it easier to use than relying solely on the Command Palette.

## UI Entry Points

### 1. Activity Bar View (New!)

**Location**: Left sidebar of VS Code

A dedicated Activity Bar icon provides persistent access to the wizard:

- **Icon**: The extension's icon appears in the Activity Bar
- **Title**: "Data Virtualization"
- **View**: When clicked, opens a sidebar panel with wizard actions

**What's in the view:**
- **Start Wizard** - Launches the data virtualization wizard
- **Help** - Opens the GitHub README documentation

**Benefits:**
- Always visible and accessible
- One-click access to the wizard
- Quick access to help documentation
- Follows VS Code UI conventions

### 2. Status Bar Item (New!)

**Location**: Bottom-right corner of VS Code window

A status bar button provides quick access:

- **Icon**: Database icon (📊)
- **Text**: "Virtualize Data"
- **Tooltip**: "Launch Data Virtualization Wizard"
- **Action**: Click to launch the wizard

**Benefits:**
- Always visible at the bottom of the window
- Doesn't take up sidebar space
- Quick one-click access from any view
- Follows standard VS Code patterns

### 3. Command Palette (Original)

**Location**: Command Palette (CTRL+SHIFT+P / CMD+SHIFT+P)

The traditional command palette access is still available:

- **Command**: "Virtualize Data Wizard"
- **Additional**: "Data Virtualization: Show Help"

**Benefits:**
- Keyboard-driven workflow
- Searchable command
- Standard VS Code behavior

## Technical Implementation

### Architecture

The implementation follows VS Code extension best practices:

1. **Tree View Provider** (`WizardTreeProvider.ts`)
   - Implements `TreeDataProvider<WizardTreeItem>`
   - Provides action items in the Activity Bar view
   - Each item has an icon and command binding

2. **Extension Activation** (`extension.ts`)
   - Registers the tree view with VS Code
   - Creates and shows the status bar item
   - Registers all commands (wizard, help)

3. **Package Contributions** (`package.json`)
   - `viewsContainers`: Defines the Activity Bar container
   - `views`: Registers the tree view
   - `commands`: Declares available commands
   - `activationEvents`: Activates on view open

### Code Structure

```
src/
├── extension.ts              # Main activation, registers all UI elements
├── WizardTreeProvider.ts     # Tree view data provider
└── VirtualizationWizard.ts   # Wizard implementation (unchanged)
```

## User Experience

### Discovery

Users can discover the wizard through:
1. **Visual Icon**: Activity Bar icon is always visible
2. **Status Bar**: Persistent button in the status bar
3. **Command Search**: Traditional command palette search

### Workflow

1. User clicks any UI entry point (Activity Bar, Status Bar, or Command Palette)
2. Wizard launches with the same step-by-step flow
3. All entry points lead to the same wizard experience

### Consistency

- All UI elements use consistent branding (database icon, extension name)
- Follows VS Code's design language and patterns
- Works with all VS Code themes (light, dark, high contrast)

## Future Enhancements (Potential)

While not implemented in this iteration, future possibilities include:

1. **Context Menu Integration**
   - Right-click on database connections in MSSQL extension
   - "Virtualize Data..." option in context menu

2. **Webview-Based Wizard**
   - Multi-step form with visual progress indicator
   - Rich HTML/CSS UI with inline validation
   - More complex but richer user experience

3. **Recent Connections Quick Pick**
   - Show recent data sources in tree view
   - One-click re-run for common scenarios

4. **Progress Tracking**
   - Show active wizard status in tree view
   - Display last run timestamp
   - Quick access to last generated scripts

## Conclusion

The new UI entry points make the Data Virtualization Wizard more discoverable and accessible while maintaining the existing functionality. Users can choose their preferred method of launching the wizard based on their workflow preferences.
