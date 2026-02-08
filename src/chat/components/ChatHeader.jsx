export function ChatHeader({ onRestart }) {
  return (
    <header className="sticky top-0 z-10 border-b-4 border-black bg-white">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="text-3xl font-black tracking-widest text-black small-caps">
            ROB<span className="text-fuchsia-500">IA</span>N
          </div>
          <div className="mt-1 text-[12px] font-extrabold uppercase tracking-widest text-black/80">
            YOUR DUMB AI COMPANION
          </div>
        </div>

        <nav className="flex shrink-0 items-center gap-2" aria-label="Primary">
          <a
            className="border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-black hover:text-white"
            href="#home"
            onClick={(e) => e.preventDefault()}
          >
            Home
          </a>
          <a
            className="border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-black hover:text-white"
            href="#cases"
            onClick={(e) => e.preventDefault()}
          >
            Cases
          </a>
          <a
            className="border-2 border-black bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-black hover:text-white"
            href="#about"
            onClick={(e) => e.preventDefault()}
          >
            About
          </a>
          <button
            type="button"
            className="border-2 border-black bg-fuchsia-500 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-fuchsia-400"
            onClick={onRestart}
          >
            Restart
          </button>
        </nav>
      </div>
    </header>
  )
}
