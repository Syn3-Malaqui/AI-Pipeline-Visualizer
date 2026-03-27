import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

type MarkdownBlockProps = {
  markdown: string
  className?: string
}

export function MarkdownBlock(props: MarkdownBlockProps) {
  const html = useMemo(() => {
    const raw = marked.parse(props.markdown, { breaks: true, gfm: true }) as string
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
  }, [props.markdown])

  return <div className={props.className} dangerouslySetInnerHTML={{ __html: html }} />
}

