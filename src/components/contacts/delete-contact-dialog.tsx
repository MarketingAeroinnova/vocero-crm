"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Confirmación de borrado de un contacto. Es irreversible, así que dice con
 * todas sus letras qué se va. Escape cancela; Enter NO confirma.
 */
export function DeleteContactDialog({
  contactName,
  onCancel,
  onConfirm,
}: {
  contactName: string;
  onCancel: () => void;
  /** Devuelve el mensaje de error, o null si se eliminó. */
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  async function confirm() {
    setBusy(true);
    setError(null);
    const problema = await onConfirm();
    // Si salió bien, quien abrió el diálogo ya lo cerró: no hay estado que tocar.
    if (problema) {
      setError(problema);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Eliminar contacto"
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">¿Eliminar a {contactName}?</h3>
        <p className="mb-3 text-[13px] leading-relaxed text-text-2">
          Se borran el contacto y su lead, con sus notas, su etapa en el
          pipeline, su historial y sus citas pasadas. Si tiene conversación, se
          borran también los mensajes y adjuntos. Deja de contar en Resultados.
        </p>
        <p className="text-xs font-medium text-danger-text">No se puede deshacer.</p>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger-soft bg-danger-tint p-2.5 text-xs text-danger-text"
          >
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Eliminando…" : "Eliminar contacto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
