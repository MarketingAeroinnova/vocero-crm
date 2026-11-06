import type { Metadata } from "next";
import { AgendarClient } from "@/components/agenda-publica/agendar-client";

export const metadata: Metadata = {
  title: "Agenda una conversación",
  description: "Elige cómo y cuándo conversar con nuestro equipo.",
  // Es un enlace para compartir en una conversación, no una página para buscar.
  robots: { index: false, follow: false },
};

export default function AgendarPage() {
  return <AgendarClient />;
}
