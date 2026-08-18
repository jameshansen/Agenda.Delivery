import Link from "next/link";
import SignupForm from "@/components/SignupForm";
import { SMS_ENABLED } from "@/lib/features";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; channel?: string; module?: string }>;
}) {
  const sp = await searchParams;
  const channel = SMS_ENABLED && sp.channel === "text" ? "text" : "email";

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Link href="/" className="text-3xl tracking-tight">
            <span className="text-green-dark">agenda</span>
            <span className="text-green">.delivery</span>
          </Link>
          <p className="mt-3 text-ink-soft">
            {sp.module
              ? "Verify your contact to finish subscribing."
              : SMS_ENABLED
                ? "Sign up with an email or phone number."
                : "Sign up with an email address."}
          </p>
        </div>

        <SignupForm
          initialChannel={channel}
          initialContact={sp.contact ?? ""}
          moduleSlug={sp.module}
        />
      </div>
    </main>
  );
}
