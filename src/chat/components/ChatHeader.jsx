export function ChatHeader({ onRestart }) {
  return (
    <header className="chat-header">
      <div className="chat-brand">DIGITAL CHAT</div>
      <nav className="chat-nav" aria-label="Primary">
        <a
          className="chat-nav-link"
          href="#home"
          onClick={(e) => e.preventDefault()}
        >
          HOME
        </a>
        <a
          className="chat-nav-link"
          href="#cases"
          onClick={(e) => e.preventDefault()}
        >
          CASES
        </a>
        <a
          className="chat-nav-link"
          href="#about"
          onClick={(e) => e.preventDefault()}
        >
          ABOUT
        </a>
        <button type="button" className="chat-action" onClick={onRestart}>
          RESTART
        </button>
      </nav>
    </header>
  )
}
