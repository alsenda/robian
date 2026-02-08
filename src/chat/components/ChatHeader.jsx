export function ChatHeader({ onRestart }) {
  return (
    <header className="sticky top-0 z-10 border-b-4 border-black bg-yellow-200">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <img
            src="/robian-logo.png"
            alt="Robian"
            className="h-14 w-auto shrink-0 rounded-none border-4 border-black bg-white p-1 shadow-brutal-sm"
            loading="eager"
            decoding="async"
          />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            className="border-4 border-black bg-fuchsia-500 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-brutal-sm hover:bg-fuchsia-400"
            onClick={onRestart}
          >
            Restart
          </button>
        </div>
      </div>
    </header>
  )
}
