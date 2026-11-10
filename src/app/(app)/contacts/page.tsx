import { ContactsClient } from "@/components/contacts/contacts-client";
import { canConfigure } from "@/lib/auth/roles";
import { getSessionOrNull } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  // Eliminar un contacto es de quien administra el negocio. El servidor lo
  // exige en la ruta; esto solo decide si el botón se enseña.
  const session = await getSessionOrNull();
  return <ContactsClient canDelete={canConfigure(session?.role)} />;
}
