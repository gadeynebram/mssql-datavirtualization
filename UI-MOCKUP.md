# UI Mockup - Data Virtualization Extension

## VS Code Window Layout with New UI Elements

```
┌─────────────────────────────────────────────────────────────────────┐
│  File  Edit  Selection  View  Go  Run  Terminal  Help              │
├──┬──────────────────────────────────────────────────────────────────┤
│  │                                                                   │
│[☰]  main.sql                                                      × │
│  │                                                                   │
├──┼──────────────────────────────────────────────────────────────────┤
│  │                                                                   │
│🔍│  SELECT * FROM external_database.dbo.customers;                  │
│  │                                                                   │
│📁│                                                                   │
│  │                                                                   │
│⚙️│                                                                   │
│  │                                                                   │
│🔌│                                                                   │
│  │                                                                   │
│📊│ ← NEW: Activity Bar Icon for Data Virtualization                │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
│  │                                                                   │
├──┴──────────────────────────────────────────────────────────────────┤
│  Problems  Output  Debug Console  Terminal                          │
│                                                                      │
│  🔌 main  ✔ Ln 1, Col 1   UTF-8   CRLF   SQL         📊 Virtualize Data │
│                                                                      │
│                                                       ↑              │
│                                                  NEW: Status Bar    │
│                                                       Button         │
└──────────────────────────────────────────────────────────────────────┘
```

## Activity Bar View (When Icon is Clicked)

```
┌──────────────────────────┐
│ DATA VIRTUALIZATION      │
├──────────────────────────┤
│                          │
│  Wizard Actions          │
│  ├─ ▶ Start Wizard      │  ← Clickable item
│  │   Launch the data... │
│  │                       │
│  └─ ❓ Help             │  ← Clickable item
│      View documentation  │
│                          │
└──────────────────────────┘
```

## Status Bar Detail

```
┌────────────────────────────────────────────────────────────┐
│ Status Bar (Bottom Right):                                  │
│                                                             │
│  🔌 main  ✔ Ln 1, Col 1   UTF-8   CRLF   SQL  [📊 Virtualize Data] │
│                                                    ↑               │
│                                               Clickable button     │
└────────────────────────────────────────────────────────────┘
```

## Command Palette (Original Method Still Works)

```
┌──────────────────────────────────────────────────────────┐
│  > virtualize                                            │
├──────────────────────────────────────────────────────────┤
│  > Virtualize Data Wizard                    ← Selected  │
│  > Data Virtualization: Show Help                        │
└──────────────────────────────────────────────────────────┘
```

## User Interaction Flow

### Method 1: Activity Bar
```
User clicks Activity Bar icon (📊)
    ↓
Sidebar opens showing "Wizard Actions"
    ↓
User clicks "Start Wizard"
    ↓
Wizard launches with step-by-step prompts
```

### Method 2: Status Bar
```
User clicks "📊 Virtualize Data" button (bottom right)
    ↓
Wizard launches directly
    ↓
Step-by-step prompts appear
```

### Method 3: Command Palette
```
User presses CTRL+SHIFT+P (or CMD+SHIFT+P)
    ↓
Types "virtualize"
    ↓
Selects "Virtualize Data Wizard"
    ↓
Wizard launches
```

## Icons Used

- **Activity Bar**: Extension icon (from images/icon.png)
- **Start Wizard**: `debug-start` (▶ play icon)
- **Help**: `question` (❓ question mark icon)
- **Status Bar**: `database` (📊 database icon)

## Theme Compatibility

All UI elements automatically adapt to the user's VS Code theme:
- Light themes
- Dark themes
- High contrast themes

The icons are using VS Code's built-in ThemeIcon class, ensuring consistency with the current theme.

## Accessibility

- All buttons have tooltips
- Tree items have descriptions
- Keyboard navigation supported
- Screen reader compatible
- Standard VS Code keyboard shortcuts work

## Benefits of Multiple Entry Points

1. **Discovery**: New users can easily find the extension via the Activity Bar icon
2. **Convenience**: Status Bar provides one-click access without switching views
3. **Power Users**: Command Palette remains available for keyboard-driven workflow
4. **Flexibility**: Users choose their preferred method based on their workflow
5. **Visibility**: Extension is more discoverable and accessible

## Implementation Notes

- Activity Bar icon appears at the bottom of the icon list (standard for extensions)
- Status Bar item is positioned on the right side (priority: 100)
- All UI elements trigger the same wizard command
- No duplication of wizard logic - single implementation, multiple entry points
