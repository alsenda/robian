import { renderFormattedText } from '../formatting.jsx'
import { renderMessageText } from '../messageText.js'

export function ChatMessages({ messages, isLoading, error, messagesViewportRef, bottomRef }) {
  return (
    <div
      className="relative z-0 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-white px-5 py-5"
      ref={messagesViewportRef}
    >
      {error && (
        <div className="relative flex max-w-[86%] flex-col gap-2 border-4 border-black bg-white px-4 py-3 text-black shadow-lg shadow-black/25">
          <div className="text-[11px] font-black uppercase tracking-widest">Error</div>
          <div className="leading-6">{error.message}</div>
        </div>
      )}
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center px-4">
          <div className="max-w-2xl border-4 border-black bg-yellow-200 px-5 py-4 text-black shadow-2xl shadow-black/35">
            <div className="text-2xl font-black leading-tight">
              How can I help you in the Neobrutalism style?
            </div>
            <div className="mt-2 text-[12px] font-extrabold uppercase tracking-widest text-black/80">
              Ask anything. Streaming answers. Raw UI.
            </div>
          </div>
        </div>
      )}
      {messages.map((message, index) => (
        <div
          key={index}
          className={
            message.role === 'user'
              ? 'relative flex max-w-[86%] flex-col gap-2 self-end border-4 border-black bg-fuchsia-500 px-4 py-3 text-white shadow-lg shadow-black/25'
              : 'relative flex max-w-[86%] flex-col gap-2 self-start border-4 border-black bg-white px-4 py-3 text-black shadow-lg shadow-black/25'
          }
        >
          <div className="text-[11px] font-black uppercase tracking-widest">
            {message.role === 'user' ? 'You' : 'Robian'}
          </div>
          <div className="leading-6 [&_p+p]:mt-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ul_ul]:mt-1 [&_li]:my-1">
            {(() => {
              const text = renderMessageText(message)
              const isLast = index === messages.length - 1
              if (!text && isLoading && isLast && message.role === 'assistant') {
                return <span className="italic opacity-70">Thinking…</span>
              }
              return renderFormattedText(text)
            })()}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
