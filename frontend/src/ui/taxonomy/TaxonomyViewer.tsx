import { useMemo, useState } from 'react'

import type { MedicineTaxonomyEntry } from '../../domain/medicineTaxonomy'
import medicinesRaw from '../../data/medicines_enriched.json'

const ALL_MEDICINES = medicinesRaw as MedicineTaxonomyEntry[]

function normalize(s: string) {
  return s.toLowerCase().trim()
}

export function TaxonomyViewer() {
  const [query, setQuery] = useState('')
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(() => new Set())

  const drugClasses = useMemo(() => {
    const set = new Set<string>()
    for (const m of ALL_MEDICINES) {
      if (m.drug_class?.trim()) set.add(m.drug_class.trim())
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [])

  const filtered = useMemo(() => {
    const q = normalize(query)
    return ALL_MEDICINES.filter((m) => {
      if (selectedClasses.size > 0 && !selectedClasses.has(m.drug_class.trim())) return false
      if (!q) return true
      const name = normalize(m.display_name)
      const cls = normalize(m.drug_class)
      const symptoms = m.symptoms_or_use_cases.map(normalize).join(' ')
      const id = normalize(m.id)
      return name.includes(q) || cls.includes(q) || symptoms.includes(q) || id.includes(q)
    })
  }, [query, selectedClasses])

  function toggleClass(dc: string) {
    setSelectedClasses((prev) => {
      const next = new Set(prev)
      if (next.has(dc)) next.delete(dc)
      else next.add(dc)
      return next
    })
  }

  function clearFilters() {
    setQuery('')
    setSelectedClasses(new Set())
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background text-on-surface antialiased font-body">
      <div className="mx-auto w-full max-w-[1600px] px-4 md:px-6 py-4 md:py-6 flex flex-col gap-4 flex-1 min-h-0">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 shrink-0">
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold text-on-background tracking-tight font-headline">
              Medicine taxonomy
            </h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Demo corpus only — not medical advice. Browse all catalog entries.
            </p>
            <p className="text-xs font-semibold text-primary mt-2">
              Showing {filtered.length} of {ALL_MEDICINES.length}
            </p>
          </div>
          <div className="flex flex-col sm:items-end gap-2 w-full sm:w-auto">
            <label className="sr-only" htmlFor="taxonomy-search">
              Search medicines
            </label>
            <div className="relative w-full sm:w-72">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] pointer-events-none">
                search
              </span>
              <input
                id="taxonomy-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, class, indication, med ID…"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {(query || selectedClasses.size > 0) && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-primary hover:underline self-start sm:self-end"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <p className="text-[10px] font-bold text-on-surface/50 uppercase tracking-wider mb-2">Drug class</p>
          <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto custom-scrollbar pr-1">
            {drugClasses.map((dc) => {
              const on = selectedClasses.has(dc)
              return (
                <button
                  key={dc}
                  type="button"
                  onClick={() => toggleClass(dc)}
                  className={
                    on
                      ? 'text-[11px] font-semibold px-2.5 py-1 rounded-full border border-primary/40 bg-primary/12 text-primary'
                      : 'text-[11px] font-medium px-2.5 py-1 rounded-full border border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:border-outline-variant/70 hover:text-on-surface transition-colors'
                  }
                >
                  {dc}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((m) => (
              <article
                key={m.id}
                className="rounded-xl border border-outline-variant/30 bg-surface p-4 shadow-sm hover:shadow-md hover:border-primary/20 transition-shadow flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-on-surface leading-tight">{m.display_name}</h2>
                  <span className="shrink-0 font-mono text-[10px] font-bold bg-primary/10 text-primary border border-primary/25 px-2 py-0.5 rounded-full">
                    {m.id}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant leading-snug">{m.drug_class}</p>
                <hr className="border-outline-variant/25" />
                <div className="space-y-2 text-xs">
                  <div>
                    <p className="text-[10px] font-bold text-on-surface/50 uppercase tracking-wider mb-0.5">
                      Indications
                    </p>
                    <p className="text-on-surface leading-relaxed">{m.symptoms_or_use_cases.join(', ')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-on-surface/50 uppercase tracking-wider mb-0.5">
                      Mechanism
                    </p>
                    <p className="text-on-surface leading-relaxed">{m.mechanism_blurb}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-on-surface/50 uppercase tracking-wider mb-0.5">
                      Cautions
                    </p>
                    <p className="text-on-surface leading-relaxed">{m.cautions_blurb}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-on-surface/50 uppercase tracking-wider mb-0.5">
                      Dose note
                    </p>
                    <p className="text-on-surface leading-relaxed">{m.demo_dose_note}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-on-surface-variant">No medicines match your filters.</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
