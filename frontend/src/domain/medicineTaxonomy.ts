/** Shape of entries in `medicines_enriched.json` (demo corpus). */

export type MedicineTaxonomyEntry = {
  id: string
  display_name: string
  drug_class: string
  symptoms_or_use_cases: string[]
  sample_user_queries: string[]
  mechanism_blurb: string
  cautions_blurb: string
  demo_dose_note: string
}
