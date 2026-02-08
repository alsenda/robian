export function ChatHeader({ onRestart }) {
  return (
    <header className="sticky top-0 z-10 border-b-4 border-black bg-yellow-200">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <img
            src="/robian-logo.png"
            alt="Robian"
            className="peer h-14 w-auto shrink-0 rounded-none border-4 border-black bg-white p-1 shadow-brutal-sm"
            loading="eager"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
          <div className="hidden text-xs font-black uppercase tracking-widest text-black peer-[style*='display: none']:block">
            <span className="border-4 border-black bg-white px-3 py-2 shadow-brutal-sm">
              Add `public/robian-logo.png`
            </span>
          </div>
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
