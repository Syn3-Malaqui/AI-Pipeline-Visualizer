import type { PipelineEvent, ScenarioSummary } from '../../shared/types'
import { MarkdownBlock } from './MarkdownBlock'
import { StreamingMarkdown } from './StreamingMarkdown'
import { StreamingText } from './StreamingText'

type ChatPanelProps = {
  scenarios: ScenarioSummary[]
  selectedScenarioId: string
  onSelectScenario: (id: string) => void
  onSendQuery: (query: string) => void
  finalAnswer: string
  events: PipelineEvent[]
  isRunning: boolean
  error: string | null
}

export function ChatPanel(props: ChatPanelProps) {
  const intermediateEvents = props.events.filter(
    (event) => event.kind === 'node_output' || event.kind === 'node_started',
  )
  const selectedScenario = props.scenarios.find((s) => s.id === props.selectedScenarioId) ?? null
  const isGeneralChat = selectedScenario?.id === 'general-chat'
  const tokenEvents = props.events.filter((event) => event.kind === 'token')

  return (
    <section className="flex flex-col gap-6 min-h-0">
      <header className="space-y-1">
        <h1 className="text-2xl font-extrabold text-on-background tracking-tight font-headline">
          RAG Visual Debugger
        </h1>
        <p className="text-on-surface-variant text-sm">
          {isGeneralChat
            ? 'Chat with a plain LLM response (no retrieval).'
            : 'Ask a question and watch each node process data in real time.'}
        </p>
      </header>

      <div className="space-y-2">
        <label
          htmlFor="scenario-select"
          className="text-xs font-semibold text-outline uppercase tracking-wider"
        >
          Environment Context
        </label>
        <div className="relative group">
          <select
            id="scenario-select"
            className="w-full appearance-none bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
            value={props.selectedScenarioId}
            onChange={(e) => props.onSelectScenario(e.target.value)}
          >
            {props.scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none">
            unfold_more
          </span>
        </div>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          const input = new FormData(e.currentTarget).get('query')
          const query = typeof input === 'string' ? input.trim() : ''
          if (!query) return
          props.onSendQuery(query)
          e.currentTarget.reset()
        }}
      >
        <div className="space-y-2">
          <label className="text-xs font-semibold text-outline uppercase tracking-wider" htmlFor="query-input">
            User Query
          </label>
          <div className="relative group">
          <textarea
            name="query"
            id="query-input"
            className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/20 outline-none resize-none transition-shadow"
            placeholder={isGeneralChat ? 'Ask anything…' : 'Enter your query about RAG, embeddings, or retrieval...'}
            disabled={props.isRunning || !props.selectedScenarioId}
          />
          <div className="absolute bottom-4 right-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={props.isRunning || !props.selectedScenarioId}
              className="bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold shadow-lg flex items-center gap-2 hover:bg-primary-container transition-colors active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {props.isRunning ? (isGeneralChat ? 'Thinking...' : 'Running...') : isGeneralChat ? 'Send' : 'Run Query'}
              <span className="material-symbols-outlined text-[16px]">
                {props.isRunning ? 'pending' : 'play_arrow'}
              </span>
            </button>
          </div>
        </div>
        </div>
      </form>

      {props.error ? (
        <div className="py-3 px-4 bg-error-container/40 border border-error/20 rounded-xl flex items-start gap-3">
          <span className="material-symbols-outlined text-error text-xl">error</span>
          <div className="text-sm text-on-error-container font-medium">{props.error}</div>
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="text-xs font-semibold text-outline uppercase tracking-wider">Final LLM Response</label>
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-sm">
          {props.isRunning && tokenEvents.length ? (
            <StreamingMarkdown events={tokenEvents} />
          ) : props.finalAnswer ? (
            <MarkdownBlock markdown={props.finalAnswer} className="ui-markdown text-sm text-on-surface" />
          ) : (
            <p className="text-sm leading-relaxed text-on-surface-variant/70 italic">Waiting for output…</p>
          )}
      </div>
      </div>

      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer list-none py-2 px-1 rounded hover:bg-surface-container-high transition-colors">
          <span className="text-xs font-semibold text-outline uppercase tracking-wider flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] group-open:rotate-90 transition-transform">
              chevron_right
            </span>
            Intermediate Raw Traces
          </span>
          <span className="text-[10px] bg-surface-container-highest px-2 py-0.5 rounded text-on-surface-variant">
            JSON
          </span>
        </summary>
        <div className="mt-4 bg-[#051a3e] rounded-xl p-4 font-mono text-[11px] text-blue-200/80 leading-relaxed overflow-x-auto shadow-inner max-h-72">
          <pre className="whitespace-pre-wrap">{intermediateEvents.length
            ? intermediateEvents
                .map((event) => {
                  const node = event.nodeId ?? 'run'
                  return `${node}: ${JSON.stringify(event.payload, null, 2)}`
                })
                .join('\n\n')
            : '{\n  "status": "no_intermediate_outputs_yet"\n}'}</pre>
        </div>
      </details>
    </section>
  )
}
