# Room Layout Planner

Plan furniture placement digitally before moving anything.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Code map (`src/`)

| File | Purpose |
|---|---|
| `room.ts` | Room shapes (`ROOM_SHAPES` registry), walls, corners, doors/windows geometry |
| `furniture.ts` | Object shapes (rect, circle, oval, L), presets |
| `layout.ts` | Holding pen, collisions, door-swing clearance, wall snapping, wall gaps |
| `dimensions.ts` | Dimension lines shared by the canvas and the PDF |
| `canvas.ts` | Interactive SVG plan (pan/zoom/drag/rotate/place) |
| `panels.ts` | Side panels: forms and property editors |
| `pdf.ts` | Scaled vector PDF export with schedule page |
| `store.ts` | Project state, undo/redo, autosave to localStorage |
| `units.ts` | Length parsing/formatting (cm, m, ft/in) |

All lengths are stored in centimetres.

## Adding a room shape

Everything downstream works from the polygon returned by a shape's `outline()`. To add e.g. an
L-shaped room: add its type to the `RoomShape` union in `room.ts` and an entry to `ROOM_SHAPES`
(label, setup fields, defaults, `outline`, `validate`). The setup dialog, walls, corner names, door
placement, collisions and PDF pick it up automatically.
"# room_layout_planner" 
