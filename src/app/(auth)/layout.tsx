import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" aria-label="AstraPair home">
        <LogoLockup />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
