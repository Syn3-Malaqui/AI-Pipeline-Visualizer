export type AppView = 'debugger' | 'taxonomy'

type AppHeaderProps = {
  activeView: AppView
  onViewChange: (view: AppView) => void
}

export function AppHeader(props: AppHeaderProps) {
  return (
    <header className="shrink-0 border-b border-outline-variant/25 bg-surface/90 backdrop-blur-md z-30">
      <div className="mx-auto w-full max-w-[1600px] px-4 md:px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-primary text-2xl shrink-0">science</span>
          <span className="font-headline font-bold text-on-surface text-sm md:text-base truncate">TrainingGuide</span>
        </div>

        <nav className="flex items-center gap-1 p-1 rounded-xl bg-surface-container-high/80 border border-outline-variant/20">
          <button
            type="button"
            onClick={() => props.onViewChange('debugger')}
            className={
              props.activeView === 'debugger'
                ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-primary bg-primary/10 border border-primary/25 shadow-sm'
                : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-lowest/80 transition-colors'
            }
          >
            <span className="material-symbols-outlined text-[18px]">hub</span>
            RAG Debugger
          </button>
          <button
            type="button"
            onClick={() => props.onViewChange('taxonomy')}
            className={
              props.activeView === 'taxonomy'
                ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-primary bg-primary/10 border border-primary/25 shadow-sm'
                : 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-lowest/80 transition-colors'
            }
          >
            <span className="material-symbols-outlined text-[18px]">account_tree</span>
            Taxonomy
          </button>
        </nav>
      </div>
    </header>
  )
}
