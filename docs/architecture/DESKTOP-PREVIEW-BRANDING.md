# Desktop preview branding provenance

The desktop preview uses the official Circuit wordmark at `assets/DemonX_wordmarks/DemonX Circuit.png` and Circuit icon assets from `assets/DemonX_Icons/DemonX_Circuit/`. The application copies only the wordmark, Windows ICO and 512px Linux PNG into its own relative runtime asset folder; other Suite artwork remains available under root `assets/` without being loaded by the UI. Artwork is not recolored, cropped, or recreated. The surrounding interface provides dark and light contrast using the existing copper/teal palette.

| Token | Dark | Light |
|---|---|---|
| Canvas | `#0f1519` | `#eef3f5` |
| Panel | `#171e22` | `#f7fafb` |
| Raised panel | `#20292e` | `#e9eff2` |
| Primary teal | `#1cb8cc` | `#0b8396` |
| Copper | `#e8873a` | `#c4621f` |
| Text | `#e4ecef` | `#17232a` |
| Muted text | `#8fa2ab` | `#55666f` |

The values are taken from the current Forge and Design-CNC UI styles. Forge's separate `docs/brand/README.md` labels its wordmark/mark concept “Draft, not approved”; Circuit therefore uses the already shared DX asset and does not claim a final corporate identity specification. Both themes are available and the user's selection is persisted locally in Electron's user-data directory.
