import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-lg font-semibold">Admin</span>
          <div className="flex gap-4">
            <Link href="/admin" className="text-sm text-neutral-300 hover:text-white">
              Dashboard
            </Link>
            <Link href="/admin/agents" className="text-sm text-neutral-300 hover:text-white">
              Agents
            </Link>
            <Link href="/admin/spider" className="text-sm text-neutral-300 hover:text-white">
              Spider
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
