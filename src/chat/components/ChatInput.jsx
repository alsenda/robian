export function ChatInput({ inputRef, input, setInput, onSubmit, isLoading }) {
  return (
    <form
      onSubmit={onSubmit}
      className="sticky bottom-0 z-10 flex gap-3 border-t-4 border-black bg-yellow-200 px-5 py-4"
    >
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Message…"
        className="flex-1 border-4 border-black bg-white px-4 py-3 text-base font-semibold text-black shadow-brutal-sm outline-none placeholder:text-black/60 focus:bg-yellow-100"
      />
      <button
        type="submit"
        disabled={isLoading || !input.trim()}
        className="border-4 border-black bg-lime-200 px-5 py-3 text-base font-black uppercase tracking-widest text-black shadow-brutal-sm hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Send
      </button>
    </form>
  )
}
