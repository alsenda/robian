export function ChatInput({ inputRef, input, setInput, onSubmit, isLoading }) {
  return (
    <form onSubmit={onSubmit} className="chat-input">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Message…"
      />
      <button type="submit" disabled={isLoading || !input.trim()}>
        Send
      </button>
    </form>
  )
}
