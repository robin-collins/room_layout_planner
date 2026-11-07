# Room Layout Planner

A browser app for planning where furniture goes before you move anything. Enter a room's
measurements, place the doors and windows, then drag objects around a scaled plan and export it
as a measured PDF.

## Features

- **Room setup** – enter internal wall-to-wall measurements in cm, metres or feet & inches.
- **Doors and windows** – place them with the mouse or by exact distance from a corner
  (e.g. "150 cm from the top-left corner"). Doors show their opening arc. You can set the hinge
  side, which way the door swings, and single or double leaves. Windows also take a height from
  the floor. Every room needs at least one door.
- **Objects** – rectangles, circles, ovals and L-shapes, with editable labels, sizes, colours and
  rotation. About 25 ready-made presets cover sofas, beds, tables, rugs and more.
- **Holding pen** – a staging area beside the room for objects you might or might not use.
- **Live checks** – warns when objects overlap, sit through a wall, or block a door's swing.
  Rugs are allowed to overlap other objects.
- **Measurements** – shows wall lengths, where each opening sits along its wall, and each
  object's distance to the nearest walls.
- **PDF export** – a vector plan at a standard scale (1:20, 1:50 …) on A4, A3 or US Letter, with
  a title block, a scale bar and an optional schedule page listing doors, windows and objects.
- **Undo/redo and autosave** – your work is saved in the browser automatically. Use
  **Save** / **Open…** to keep layouts as `.layout.json` files.

## Getting started

Requires Node.js 20 or later.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static site in dist/
npm run preview    # serve the built site
npm run typecheck  # TypeScript only
```

The build is a static site, so `dist/` can be hosted anywhere.

## Using it

1. Enter the room's name and dimensions.
2. Add the first door, either with **Place with mouse** or by typing a wall, a corner and a
   distance.
3. Add more doors and windows if needed, then create objects. New objects go into the holding
   pen, and you drag them into the room from there.
4. Click **Export PDF**.

| Keys | Action |
|---|---|
| Drag | Move an object (snaps to the grid and walls; hold <kbd>Alt</kbd> to turn snapping off) |
| Rotate handle | Rotate in 15° steps (hold <kbd>Shift</kbd> to rotate freely) |
| <kbd>R</kbd> / <kbd>Shift</kbd>+<kbd>R</kbd> | Rotate 90° clockwise / anticlockwise |
| Arrow keys | Nudge 1 cm (hold <kbd>Shift</kbd> for 10 cm) |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplicate |
| <kbd>Delete</kbd> | Delete the selected object or opening |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save to file |
| <kbd>Esc</kbd> | Cancel placing / clear the selection |

## Tech

Vite + TypeScript with no framework. The plan is drawn as SVG, and PDFs are made with
[jsPDF](https://github.com/parallax/jsPDF).

### Code map (`src/`)

| File | Purpose |
|---|---|
| `room.ts` | Room shapes (`ROOM_SHAPES` registry), walls, corners, door and window geometry |
| `furniture.ts` | Object shapes (rect, circle, oval, L) and presets |
| `layout.ts` | Holding pen, collisions, door-swing clearance, wall snapping, wall gaps |
| `dimensions.ts` | Dimension lines shared by the canvas and the PDF |
| `canvas.ts` | Interactive SVG plan (pan, zoom, drag, rotate, place) |
| `panels.ts` | Side panels: forms and property editors |
| `modals.ts` | Room setup and PDF export dialogs |
| `pdf.ts` | Scaled vector PDF export with a schedule page |
| `store.ts` | Project state, undo/redo, autosave to localStorage |
| `actions.ts` | Commands shared by the UI and keyboard shortcuts |
| `units.ts` | Reading and formatting lengths (cm, m, ft/in) |
| `geometry.ts` | Vector and polygon maths |

All lengths are stored in centimetres. The y axis points down, and objects are positioned by
their centre and rotated clockwise in degrees.

### Adding a room shape

Rooms are rectangular for now, but everything downstream works from the polygon returned by a
shape's `outline()`. To add an L-shaped room, for example, add its type to the `RoomShape` union
in `room.ts` and an entry to `ROOM_SHAPES` (label, setup fields, defaults, `outline`,
`validate`). The setup dialog, walls, corner names, door placement, collision checks and the PDF
then pick it up automatically.
