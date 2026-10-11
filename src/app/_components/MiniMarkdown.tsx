'use client';

/**
 * Renders a Genie reply as Markdown. The Bedrock agent answers in GitHub-
 * flavored Markdown (bold, inline code, pipe tables, task-list checkboxes,
 * headings, rules); this turns it into real formatting instead of showing the
 * raw asterisks and pipes.
 *
 * Thin wrapper over react-markdown + remark-gfm. The `.md*` classes it emits
 * are styled in app.css. HTML in the source is NOT rendered (react-markdown
 * escapes it by default), so untrusted model output can't inject markup.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MiniMarkdown({text}: {text: string}) {
  return (
    <div className='md'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({children}) => <p className='md-p'>{children}</p>,
          h1: ({children}) => <p className='md-h md-h1'>{children}</p>,
          h2: ({children}) => <p className='md-h md-h2'>{children}</p>,
          h3: ({children}) => <p className='md-h md-h3'>{children}</p>,
          h4: ({children}) => <p className='md-h md-h4'>{children}</p>,
          h5: ({children}) => <p className='md-h md-h5'>{children}</p>,
          h6: ({children}) => <p className='md-h md-h6'>{children}</p>,
          hr: () => <hr className='md-hr' />,
          ul: ({children}) => <ul className='md-list'>{children}</ul>,
          ol: ({children}) => <ol className='md-list'>{children}</ol>,
          table: ({children}) => <table className='md-table'>{children}</table>,
          a: ({href, children}) => (
            <a href={href} target='_blank' rel='noopener noreferrer'>
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
