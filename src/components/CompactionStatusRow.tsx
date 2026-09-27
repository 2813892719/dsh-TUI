import React from 'react'
import { Box, Text } from '../ui.js'
import { useAnimationFrame } from '../ink/hooks/use-animation-frame.js'
import { useTerminalSize } from '../ink/hooks/use-terminal-size.js'
import { stringWidth } from '../ink/stringWidth.js'
import { t } from '../i18n.js'
import { formatDuration, formatTokens } from '../terminal-utils/format.js'
import { SpinnerGlyph } from './Spinner/SpinnerGlyph.js'
import type { CompactionStatus } from '../adapter/ports/channel-view.js'

/** Field separator, matching the working spinner's row. */
const SEP = ' · '
/** Cells kept clear so a long row never wraps into the prompt below. */
const RESERVE = 2
/** Spinner cadence of the working spinner, reused so the two slots agree. */
const FRAME_MS = 140

/**
 * The in-flight compaction row, in the same slot as the working spinner.
 *
 * A `/compact` runs for tens of seconds (measured on real sessions: median
 * ~25s, p90 ~70s) and the old transient toast covered the first four of them,
 * leaving the screen indistinguishable from idle. This row stays for the whole
 * bracket, counts up, and shows the summarizer's own output as it streams
 * (`compaction.outputChars`) — the one honest progress signal a compaction has,
 * since the host exposes no proportional one.
 */
export function CompactionStatusRow({
  compaction,
}: {
  compaction: CompactionStatus
}): React.ReactNode {
  const { columns } = useTerminalSize()
  const [viewportRef, time] = useAnimationFrame(FRAME_MS)

  // Derived from wall-clock each frame (the row is only mounted while a
  // compaction runs, so the tick stops with it).
  const elapsed = formatDuration(Date.now() - compaction.startedAt)
  const frame = Math.floor(time / FRAME_MS)
  const label = t('compact-working')
  const detail = compaction.phase === 'summary'
    ? `↓ ${formatTokens(Math.round(compaction.outputChars / 4))} tokens`
    : t('compact-phase-prefill')
  const hint = compaction.cancellable ? t('compact-esc-cancel') : undefined

  // The hint is actionable and the phase is informative, so a narrow terminal
  // drops the phase first and the hint only when even that does not fit.
  const budget = Math.max(0, columns - RESERVE)
  const base = stringWidth(label) + 2
  const elapsedWidth = stringWidth(SEP) + stringWidth(elapsed)
  const hintWidth = hint === undefined ? 0 : stringWidth(SEP) + stringWidth(hint)
  const detailWidth = stringWidth(SEP) + stringWidth(detail)
  const showHint = hint !== undefined && base + elapsedWidth + hintWidth <= budget
  const showDetail = base + elapsedWidth + hintWidth + detailWidth <= budget

  return (
    <Box ref={viewportRef} flexDirection="row" flexWrap="wrap" marginTop={1} width="100%">
      <SpinnerGlyph frame={frame} messageColor="accent" />
      <Text color="accent">{label}</Text>
      {showDetail && <Text dimColor>{`${SEP}${detail}`}</Text>}
      <Text dimColor>{`${SEP}${elapsed}`}</Text>
      {showHint && <Text dimColor>{`${SEP}${hint}`}</Text>}
    </Box>
  )
}
