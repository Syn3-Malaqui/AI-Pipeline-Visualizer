import { useState } from 'react'

import { AppHeader, type AppView } from './ui/layout/AppHeader'
import { WorkspaceSplit } from './ui/layout/WorkspaceSplit'
import { TaxonomyViewer } from './ui/taxonomy/TaxonomyViewer'

function App() {
  const [activeView, setActiveView] = useState<AppView>('debugger')

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <AppHeader activeView={activeView} onViewChange={setActiveView} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeView === 'debugger' ? <WorkspaceSplit /> : <TaxonomyViewer />}
      </div>
    </div>
  )
}

export default App
