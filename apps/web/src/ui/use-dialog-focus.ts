import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside an open modal and restores its connected opener.
 * `returnFocusRef` replaces the opener when it closes with the modal, such as a menu item (#170).
 */
export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  initialSelector: string,
  busy = false,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    const items = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.getClientRects().length > 0,
      );
    const focusInside = () => {
      const initial = dialog.querySelector<HTMLElement>(initialSelector);
      (initial && !initial.matches(":disabled")
        ? initial
        : (items()[0] ?? dialog)
      ).focus();
    };
    focusInside();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const targets = items();
      const first = targets[0];
      const last = targets.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog!.focus();
      } else if (
        !dialog!.contains(document.activeElement) ||
        document.activeElement === dialog ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    function onFocus(event: FocusEvent) {
      if (event.target instanceof Node && !dialog!.contains(event.target))
        focusInside();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocus);
      const target = returnFocusRef?.current ?? opener;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [open, dialogRef, initialSelector, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (busy) dialog?.focus();
    else if (document.activeElement === dialog)
      dialog?.querySelector<HTMLElement>(initialSelector)?.focus();
  }, [open, busy, dialogRef, initialSelector]);
}
