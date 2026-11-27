# Captnz Board

Zero-latency 4K Interactive Whiteboard, PDF Annotator, and Presentation Viewer built with **Tauri v2 (Rust + HTML5/CSS3/Vanilla ES Modules)** for Windows Smart Boards (Interactive Flat Panels) and touchscreens.

## Project Structure

```text
captnz-board/
├── package.json                  # Dependencies (Tauri v2, PDF.js, jsPDF, Vite)
├── vite.config.js                # Vite bundler config for Tauri v2
├── index.html                    # 3-layer hardware-accelerated canvas & floating UI
├── build-windows.ps1             # One-click Windows PowerShell build script
├── src/
│   ├── main.js                   # App bootstrap, DPR scaling, keyboard shortcuts
│   ├── styles/main.css           # Glassmorphism UI, Dark/Light themes, RTL support
│   ├── i18n/translations.js      # English, Malayalam (മലയാളം), Arabic (العربية)
│   ├── engine/
│   │   ├── inkEngine.js          # Pointer Events, coalesced input, Bezier ink, 7 brushes, vanishing ink, laser
│   │   ├── shapeRecognizer.js    # Draw-and-hold auto-shapes & highlighter straightener
│   │   ├── gestureManager.js     # Single-touch draw, 2-finger pinch-zoom/pan, Palm Eraser/Rejection
│   │   └── lassoSnip.js          # Lasso crop from PDF/board & paste to blank page
│   ├── document/
│   │   ├── pageManager.js        # Multi-page model, backgrounds, instant '+' blank page, undo/redo
│   │   ├── fileImporter.js       # PDF.js loader, Image importer, PPTX/PPT Rust bridge
│   │   ├── pdfExporter.js        # High-resolution annotated PDF export via jsPDF
│   │   └── recoveryStore.js      # IndexedDB + Tauri local auto-save crash recovery
│   └── ui/
│       ├── draggable.js          # Touch-friendly drag & viewport-clamp utility
│       ├── drawer.js             # Auto-hide Hamburger Slide Drawer
│       ├── floatingOrb.js        # Draggable Floating Circle Toolbox (Orb)
│       └── navControls.js        # Draggable '<' '>' arrows & '+' blank page button
└── src-tauri/
    ├── Cargo.toml                # Rust crate manifest (size-optimized LTO release profile)
    ├── build.rs                  # Tauri v2 build script
    ├── tauri.conf.json           # Captnz Board window & Windows NSIS/MSI bundle config
    ├── capabilities/default.json # Tauri v2 dialog & filesystem permissions
    ├── icons/                    # App icons (32x32, 128x128, 128x128@2x, icon.ico)
    └── src/
        ├── main.rs               # Windows subsystem entry point
        ├── lib.rs                # Native file I/O, LibreOffice/PowerPoint PPT->PDF, crash recovery
        └── pptx_fallback.rs      # Pure-Rust .pptx slide text & image extractor fallback
```

## Build Windows `.exe` Installer (PowerShell)

### 1. Prerequisites (one-time setup)
Install Node.js LTS, Rust (`rustup`), and Microsoft Visual Studio C++ Build Tools:

```powershell
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Rustlang.Rustup
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

*(Restart PowerShell after installing prerequisites so `node`, `npm`, and `cargo` are on `PATH`.)*

### 2. Install Dependencies & Compile `.exe`

```powershell
cd captnz-board
npm install
npm run tauri build
```

The compiled Windows installer will be generated at:
- `src-tauri\target\release\bundle\nsis\Captnz Board_1.0.0_x64-setup.exe`
- `src-tauri\target\release\bundle\msi\Captnz Board_1.0.0_x64_en-US.msi`
- Standalone portable binary: `src-tauri\target\release\captnz-board.exe`
