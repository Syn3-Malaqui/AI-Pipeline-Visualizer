type PlaybackControlsProps = {
  paused: boolean
  speed: number
  onPause: () => void
  onResume: () => void
  onStep: () => void
  onSpeedChange: (value: number) => void
}

export function PlaybackControls(props: PlaybackControlsProps) {
  return (
    <div className="flex items-center gap-3 bg-surface/70 backdrop-blur-md border border-outline-variant/30 px-3 py-2 rounded-lg shadow-sm">
      <div className="flex items-center bg-surface-container-low rounded-lg p-1 border border-outline-variant/20">
        <button
          type="button"
          className="w-8 h-8 rounded-md flex items-center justify-center text-on-surface-variant opacity-40 cursor-not-allowed"
          aria-label="Previous (not available)"
          disabled
        >
          <span className="material-symbols-outlined">skip_previous</span>
        </button>
        <button
          type="button"
          onClick={props.paused ? props.onResume : props.onPause}
          className={
            props.paused
              ? 'w-8 h-8 rounded-md flex items-center justify-center hover:bg-surface-container-lowest text-on-surface-variant transition-colors'
              : 'w-8 h-8 rounded-md flex items-center justify-center bg-primary text-on-primary shadow-sm'
          }
          aria-label={props.paused ? 'Resume' : 'Pause'}
        >
          <span className="material-symbols-outlined">{props.paused ? 'play_arrow' : 'pause'}</span>
        </button>
        <button
          type="button"
          onClick={props.onStep}
          className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-surface-container-lowest text-on-surface-variant transition-colors"
          aria-label="Step"
        >
          <span className="material-symbols-outlined">skip_next</span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Playback Speed</span>
        <input
          className="w-28 accent-primary h-1 bg-surface-container-highest rounded-full"
          type="range"
          min={1}
          max={4}
          step={1}
          value={props.speed}
          onChange={(e) => props.onSpeedChange(Number(e.target.value))}
          aria-label="Playback speed"
        />
        <span className="bg-primary/5 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary/20">
          {props.speed}x
        </span>
      </div>
    </div>
  )
}
