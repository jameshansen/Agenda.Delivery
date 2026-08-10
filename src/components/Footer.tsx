import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-black/5">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-ink-soft sm:flex-row">
        <p>
          <span className="text-green-dark">agenda</span>
          <span className="text-green">.delivery</span> — open-source AI agenda
          monitoring
        </p>
        <nav className="flex gap-5">
          {/* ponytail: repo link is a placeholder until the repo is public. */}
          <a href="#" className="hover:text-green">
            GitHub
          </a>
          <Link href="/map" className="hover:text-green">
            Map
          </Link>
          <Link href="/spider" className="hover:text-green">
            Spider
          </Link>
          <a
            href="https://jameshansen.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-green"
          >
            jameshansen.ai
          </a>
        </nav>
      </div>
    </footer>
  );
}
