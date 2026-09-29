import { useEffect, useCallback } from "react";

export function useDirtyPreroute(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Intercept clicks on common navigation elements: TabBar (role="tab") and anchors
      const isNavTrigger = target.closest('a[href], [role="tab"]');
      if (isNavTrigger) {
        if (!window.confirm("You have unsaved changes. Are you sure you want to leave?")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Use capture phase to intercept the click before it reaches the React event system
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [isDirty]);

  const confirmLeave = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Are you sure you want to leave?");
  }, [isDirty]);

  return confirmLeave;
}
