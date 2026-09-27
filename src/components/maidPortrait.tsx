import React from 'react'
import { Image, useTerminalImageCellSize } from '../ui.js'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { TerminalImageSource } from '../ink/terminal-image.js'
import { DEFAULT_TERMINAL_CELL_SIZE } from '../ink/terminal-image.js'
import { loadSharp } from '../dsh-adapter/sharp.js'

/**
 * The maid portrait (鲸鱼娘) for `dsh-tui.whaleGirl` and the star modal —
 * the author-designed 464×464 pixel art shipped at `assets/whale-girl/`,
 * rendered FIRST as a real raster through the terminal image protocols
 * (Kitty graphics / Sixel): full fidelity, anti-aliased curves, the whole
 * palette. The chain degrades per surface when images cannot show — the
 * header falls back to the character-art maid (`WhaleGirl.tsx`, the
 * author's placeholder), the star modal to the animated pixel whale — so
 * the setting never leaves the header worse than the whale it replaces.
 */

/** Asset candidates cover both layouts: `lib/types/components` (published)
 * sits one level deeper than `src/components` (repo checkout). */
const ASSET_CANDIDATES: readonly string[] = [
  '../../../assets/whale-girl/whale-girl.png',
  '../../assets/whale-girl/whale-girl.png',
].map(relative => fileURLToPath(new URL(relative, import.meta.url)))

let loadOnce: Promise<TerminalImageSource | undefined> | undefined

/**
 * Decode the portrait once per process (cached; failures cache as
 * `undefined` so a broken install never retries on every render).
 * @returns RGBA source for `<Image>`, or `undefined` when unavailable.
 */
export function loadMaidPortrait(): Promise<TerminalImageSource | undefined> {
  loadOnce ??= (async () => {
    const path = ASSET_CANDIDATES.find(candidate => existsSync(candidate))
    if (path === undefined) return undefined
    try {
      const sharp = await loadSharp()
      if (sharp === undefined) return undefined
      const decoded = await sharp(readFileSync(path), { failOn: 'error' })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      if (decoded.info.channels !== 4
        || decoded.data.byteLength !== decoded.info.width * decoded.info.height * 4) return undefined
      const rgba: TerminalImageSource = {
        data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
        width: decoded.info.width,
        height: decoded.info.height,
      }
      return trimTransparent(rgba)
    } catch {
      return undefined
    }
  })()
  return loadOnce
}

/**
 * Trim fully-transparent borders (the art's canvas margins) with a small
 * transparent pad. Sixel has no alpha — raster pixels composite onto an
 * opaque backing — so untrimmed padding would show as an empty frame around
 * the character; trimming hands the terminal the artwork itself and lets
 * the same cell box draw her larger.
 */
function trimTransparent(source: TerminalImageSource, pad = 4): TerminalImageSource {
  const { data, width, height } = source
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Anti-aliased edges carry alpha > 0, so only truly empty pixels fall
      // outside the bounding box.
      if (data[(y * width + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return source
  const left = Math.max(0, minX - pad)
  const top = Math.max(0, minY - pad)
  const right = Math.min(width - 1, maxX + pad)
  const bottom = Math.min(height - 1, maxY + pad)
  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1
  if (cropWidth === width && cropHeight === height) return source
  const cropped = new Uint8Array(cropWidth * cropHeight * 4)
  for (let y = 0; y < cropHeight; y++) {
    const from = ((top + y) * width + left) * 4
    cropped.set(data.subarray(from, from + cropWidth * 4), y * cropWidth * 4)
  }
  return { data: cropped, width: cropWidth, height: cropHeight }
}

/**
 * The decoded portrait, once the terminal's image support is confirmed.
 * @param enabled - graphics availability (`useTerminalImages()`); the decode
 * never starts otherwise.
 * @returns the RGBA source, or `undefined` while pending/unavailable.
 */
export function useMaidPortrait(enabled: boolean): TerminalImageSource | undefined {
  const [source, setSource] = React.useState<TerminalImageSource | undefined>(undefined)
  React.useEffect(() => {
    if (!enabled) return
    let live = true
    void loadMaidPortrait().then(next => {
      if (live && next !== undefined) setSource(next)
    })
    return () => { live = false }
  }, [enabled])
  return enabled ? source : undefined
}

/** Fallback aspect before the source lands (square canvas). */
const MAID_RATIO = 1

/**
 * The portrait's center column inside the whale's 40-column slot: the
 * aspect-fit image spans columns 5..34 (center 19.5). The welcome tagline
 * centers on this instead of `WHALE_CENTER` while the portrait shows.
 */
export const MAID_BOX_CENTER = 19.5

/**
 * The portrait as an Ink component: a `width × height` cell box (aspect-fit
 * from the real cell metrics so pixels stay square), centered horizontally
 * by the caller's slot. `presentation` follows the surface — `'transcript'`
 * opts into Sixel for the scrollable header, `'preview'` for modal cards.
 */
export function MaidPortrait({
  source,
  maxColumns,
  maxRows,
  presentation,
}: {
  /** Decoded RGBA snapshot; `undefined` keeps the caller's fallback. */
  readonly source?: TerminalImageSource
  /** Cell budget (the header passes the whale's 40-column slot). */
  readonly maxColumns: number
  readonly maxRows: number
  readonly presentation: 'transcript' | 'preview'
}): React.ReactNode {
  const cell = useTerminalImageCellSize() ?? DEFAULT_TERMINAL_CELL_SIZE
  const cellRatio = cell.height / cell.width
  // Fit the TRIMMED artwork's own aspect, not the source canvas: the raster
  // is her bounding box, so she fills the slot instead of floating in
  // transparent padding.
  const ratio = source !== undefined && source.height > 0 ? source.width / source.height : MAID_RATIO
  let width = maxColumns
  let height = Math.round(width / (cellRatio * ratio))
  if (height > maxRows) {
    height = maxRows
    width = Math.max(1, Math.min(maxColumns, Math.round(cellRatio * height * ratio)))
  }
  return (
    <Image
      source={source}
      width={width}
      height={height}
      alt=""
      presentation={presentation}
    />
  )
}
