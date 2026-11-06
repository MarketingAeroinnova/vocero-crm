import { DEFAULT_BRANDING } from "@/lib/branding";
import { getBranding } from "@/server/branding";
import { BrandLogo } from "@/components/brand-mark";

/**
 * 070 — Páginas públicas (sin sesión). Misma escenografía que la entrada, pero
 * más ancha: aquí la persona elige entre varias opciones, no llena un solo
 * formulario.
 */
export default async function PublicoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return (
    <main className="relative min-h-screen overflow-hidden bg-subtle px-4 py-8 sm:py-12">
      <div className="brand-grid absolute inset-0" aria-hidden />
      <div className="brand-glow brand-glow-a" aria-hidden />
      <div className="brand-glow brand-glow-b" aria-hidden />
      <div className="relative mx-auto w-full max-w-2xl">
        <div className="mb-6 flex justify-center">
          <BrandLogo branding={branding} size="lg" />
        </div>
        {children}
      </div>
    </main>
  );
}
