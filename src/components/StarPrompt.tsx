import React from 'react'
import { Box, Text, useInput, useTerminalImages, useTerminalSize } from '../ui.js'
import { getLang, subscribeLang, t } from '../i18n.js'
import { MaidPortrait, useMaidPortrait } from './maidPortrait.js'
import { STANDARD_FRAME_INDEX, WhaleArt } from './Whale.js'
import { OPENING_SEQUENCES } from './whaleFrames.js'
import type { StarMilestone } from '../usageStats.js'

/** Portrait + text side by side need this many columns (art slot 40 + gap 2 +
 * text 40 + card chrome 6); below that the card drops the art and stacks
 * text. The slot stays 40 wide so the raster portrait and the animated pixel
 * whale fallback (40×13) share one card width. */
const MIN_ART_COLUMNS = 90
/** Card height with the art (16 art rows + 2 border rows); terminals shorter
 * than this + 2 margin rows get the text-only card. */
const MIN_ART_ROWS = 20
/** Text column width inside the card: the longest zh body line is 48 columns
 * and wraps here; enough for every button and hint line to stay one row. */
const TEXT_COLUMNS = 40
/** Dwell on the standard pose before the fallback whale's intro loops. */
const WHALE_REST_MS = 3000

/** The two things the modal can do (Chat supplies the real actions; tests
 * override them through the same seam). */
export interface StarPromptActions {
  onStar: () => void
  onOpen: () => void
}

/**
 * The one-time "asks for a star" startup modal (usage milestones `99h` /
 * `999 launches`, see `usageStats.ts`). Chat mounts it over a dimmed
 * click-catcher on boot when `dueStarModal()` says the moment arrived —
 * never mid-turn, at most one milestone per boot, `Esc`/click-outside
 * closes, and unmounting hands the keyboard straight back (nothing is
 * left registered, so it cannot steal keys after closing).
 *
 * The copy is deliberately restrained and sincere: one title line naming
 * the milestone, three body lines, two actions — `gh` one-key star or open
 * the repo in a browser — with the selection cursor on the star line and a
 * low-pressure `Esc`-to-dismiss hint on the same row the buttons live in.
 * The art slot is the raster maid FIRST (`maidPortrait.tsx`); without image
 * protocols it falls back to the ANIMATED pixel whale (the classic intro
 * on a loop) — never a static placeholder.
 */
export function StarPrompt({
  milestone,
  actions,
  onClose,
}: {
  /** The reached milestone (drives the title's hours/launches wording). */
  readonly milestone: StarMilestone
  readonly actions: StarPromptActions
  readonly onClose: () => void
}): React.ReactNode {
  React.useSyncExternalStore(subscribeLang, getLang)
  const { columns, rows } = useTerminalSize()
  const imagesAvailable = useTerminalImages()
  const maidSource = useMaidPortrait(imagesAvailable)
  const withArt = columns >= MIN_ART_COLUMNS && rows >= MIN_ART_ROWS
  const whaleAnimating = withArt && !(imagesAvailable && maidSource !== undefined)
  const [whaleFrame, setWhaleFrame] = React.useState(STANDARD_FRAME_INDEX)
  // 回落的鲸鱼要「会动」：循环经典开场（眨眼 → 喷水 → 摆尾），收尾在
  // 标准帧上歇 3 秒再来一轮——共用 whaleFrames 的节奏表，不另造帧。
  // 只在回落形态驱动；弹窗一关（整树卸载）定时器即清。
  React.useEffect(() => {
    if (!whaleAnimating) return
    const sequence = OPENING_SEQUENCES.classic
    let step = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      const current = sequence[step] ?? sequence[0]!
      setWhaleFrame(current.frame)
      const last = step === sequence.length - 1
      step = (step + 1) % sequence.length
      timer = setTimeout(tick, last ? WHALE_REST_MS : current.ms)
      ;(timer as { unref?: () => void }).unref?.()
    }
    tick()
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [whaleAnimating])
  const [selected, setSelected] = React.useState(0)
  // Some terminals report one Enter twice (parsed Return then raw CR); the
  // modal must not fire its action twice for one press.
  const lastEnterRef = React.useRef(0)

  useInput((input, key) => {
    if (key.escape) {
      onClose()
      return
    }
    if (key.upArrow || key.downArrow || key.tab) {
      setSelected(previous => (previous + 1) % 2)
      return
    }
    if (key.return) {
      const now = Date.now()
      if (now - lastEnterRef.current < 50) return
      lastEnterRef.current = now
      activate(selected, actions)
    }
  })

  const textColumns = withArt ? TEXT_COLUMNS : Math.max(24, Math.min(TEXT_COLUMNS + 8, columns - 6))
  const cardColumns = withArt ? 88 : Math.min(columns, textColumns + 6)
  const cardRows = withArt ? 18 : 12
  const left = Math.max(0, Math.floor((columns - cardColumns) / 2))
  const bottom = Math.max(0, Math.min(Math.floor((rows - cardRows) / 2), rows - cardRows))

  const title = milestone.hours !== undefined
    ? t('star-modal-title-hours', { hours: milestone.hours })
    : t('star-modal-title-launches', { launches: milestone.launches ?? 0 })
  const options = [t('star-modal-star'), t('star-modal-open')]

  return (
    <>
      {/* Click-catcher: absolute, childless, and stable (handlers are
          callback-stable) so nothing dirties it — the card below is an
          opaque SIBLING, matching the modal-layer conventions documented
          on ImagePreviewOverlay. Anchored to the ROOT's BOTTOM edge, not
          the top: in inline mode the document grows past the viewport and
          a top-anchored layer would sit in scrollback, invisible while
          still owning the keyboard. */}
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width="100%"
        height={rows}
        flexShrink={0}
        backdrop="dim"
        onClick={onClose}
      />
      <Box
        position="absolute"
        left={left}
        bottom={bottom}
        width={cardColumns}
        flexDirection="row"
        gap={2}
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
        overflow="hidden"
        borderStyle="round"
        borderColor="inactive"
        paddingX={2}
        backgroundColor="toolCardBackground"
        opaque
        onClick={event => { event.stopImmediatePropagation() }}
      >
        {withArt && (
          // 40×16 槽位：最优先真图立绘（按裁掉透明边后的实际比例适配）；
          // 终端图像协议不可用时回落**会动的像素鲸鱼**（经典开场循环，
          // 40×13 居中）。
          <Box width={40} height={16} flexShrink={0} flexDirection="row" justifyContent="center" alignItems="center">
            {imagesAvailable && maidSource !== undefined ? (
              <MaidPortrait source={maidSource} maxColumns={40} maxRows={16} presentation="preview" />
            ) : (
              <WhaleArt frameIndex={whaleFrame} width={40} />
            )}
          </Box>
        )}
        <Box flexDirection="column" width={textColumns}>
          <Text color="accent" bold wrap="wrap">{title}</Text>
          <Box height={1} />
          <Text wrap="wrap">{t('star-modal-body-1')}</Text>
          <Text wrap="wrap">{t('star-modal-body-2')}</Text>
          <Text wrap="wrap">{t('star-modal-body-3')}</Text>
          <Box height={1} />
          {options.map((label, index) => (
            <Box
              key={label}
              flexShrink={0}
              onClick={event => {
                event.stopImmediatePropagation()
                setSelected(index)
                activate(index, actions)
              }}
            >
              <Text color={index === selected ? 'accent' : undefined} bold={index === selected} dimColor={index !== selected}>
                {index === selected ? '▸ ' : '  '}{label}
              </Text>
            </Box>
          ))}
          <Box height={1} />
          <Text dimColor wrap="wrap">{t('star-modal-hint')}</Text>
        </Box>
      </Box>
    </>
  )
}

/** Run the selected action (shared by Enter and the click path). */
function activate(index: number, actions: StarPromptActions): void {
  if (index === 0) actions.onStar()
  else actions.onOpen()
}
