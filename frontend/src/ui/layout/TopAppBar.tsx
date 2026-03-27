export function TopAppBar() {
  return (
    <header className="w-full sticky top-0 z-40 bg-surface border-b border-outline-variant/20 h-14 px-6 flex justify-between items-center">
      <div className="flex items-center gap-4">
        <span className="text-lg font-bold tracking-tight text-on-surface font-headline">
          RAG Visual Debugger
        </span>
        <nav className="hidden lg:flex items-center gap-6 ml-8">
          <a
            className="text-on-surface/60 hover:text-primary text-sm font-medium transition-colors"
            href="#"
          >
            Workspaces
          </a>
          <a className="text-primary font-semibold border-b-2 border-primary pb-1 text-sm" href="#">
            Pipelines
          </a>
          <a className="text-on-surface/60 hover:text-primary text-sm font-medium transition-colors" href="#">
            Logs
          </a>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-2 rounded-full hover:bg-surface-container-low transition-colors text-on-surface-variant"
            aria-label="Settings"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button
            type="button"
            className="p-2 rounded-full hover:bg-surface-container-low transition-colors text-on-surface-variant"
            aria-label="Help"
          >
            <span className="material-symbols-outlined">help</span>
          </button>
          <button
            type="button"
            className="p-2 rounded-full hover:bg-surface-container-low transition-colors text-on-surface-variant"
            aria-label="Account"
          >
            <span className="material-symbols-outlined">account_circle</span>
          </button>
        </div>
        <button
          type="button"
          className="bg-gradient-to-br from-primary to-primary-container text-on-primary px-4 py-1.5 rounded-lg text-sm font-medium shadow-sm active:scale-[0.98] transition-transform"
        >
          Deploy
        </button>
      </div>
    </header>
  )
}

