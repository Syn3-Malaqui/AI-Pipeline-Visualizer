type SideNavItem = {
  id: string
  label: string
  icon: string
  active?: boolean
}

const ITEMS: SideNavItem[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'pipeline', label: 'Pipeline', icon: 'account_tree', active: true },
  { id: 'trace', label: 'Trace', icon: 'reorder' },
  { id: 'metrics', label: 'Metrics', icon: 'analytics' },
  { id: 'settings', label: 'Settings', icon: 'tune' },
]

export function SideNav() {
  return (
    <nav className="hidden md:flex fixed left-0 top-0 h-full w-20 flex-col py-4 gap-4 bg-surface/80 backdrop-blur-md border-r border-outline-variant/30 z-50">
      <div className="flex flex-col items-center gap-6">
        <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-white shadow-sm">
          <span className="material-symbols-outlined">account_tree</span>
        </div>
        <div className="flex flex-col gap-4 w-full px-2">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.active
                  ? 'flex flex-col items-center gap-1 p-2 bg-gradient-to-b from-surface-container-lowest to-surface-container-low text-primary rounded-xl shadow-sm border border-outline-variant/30'
                  : 'flex flex-col items-center gap-1 p-2 rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface'
              }
            >
              <span
                className="material-symbols-outlined"
                style={
                  item.active ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined
                }
              >
                {item.icon}
              </span>
              <span
                className={
                  item.active
                    ? 'text-[10px] font-semibold uppercase tracking-wide'
                    : 'text-[10px] font-medium uppercase tracking-wide'
                }
              >
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-auto flex flex-col items-center gap-4 px-2">
        <button
          type="button"
          className="p-2 rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
          aria-label="Docs"
        >
          <span className="material-symbols-outlined">description</span>
        </button>
        <button
          type="button"
          className="p-2 rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
          aria-label="Feedback"
        >
          <span className="material-symbols-outlined">feedback</span>
        </button>
      </div>
    </nav>
  )
}

