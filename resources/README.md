# Runtime assets

`ym/` contains the assets needed by the React interface: skins, emoticons, sounds, login artwork, and app icons. Keep this runtime tree with the project so development and packaging don't depend on the ignored `_extracted/` directory.

Electron serves these files to React through `ymres://`. During development the root is `resources/ym/`; electron-builder copies it to `Contents/Resources/ym/` on macOS, beside `app.asar`. The installed app reads from `process.resourcesPath/ym/`.

To regenerate this tree, run `npm run extract` with the original installer, or `npm run assets:prepare` if extraction and image conversion are already complete. Preparation excludes installer executables, Flash/CAB files, and thumbnail databases.

The artwork and audio are derived from the Yahoo installer. Their source and licensing status are described in the [README credits](../README.md#credits-and-assets).
