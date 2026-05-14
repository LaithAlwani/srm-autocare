"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared open/close transition for modals. The modal mounts in its hidden
// state (opacity-0 + slight translate) and `shown` flips to true on the next
// animation frame so the CSS transition has something to animate from.
//
// `handleClose` keeps the modal mounted for `duration` ms so the close
// animation finishes before the parent unmounts it. Wrap any close trigger
// inside the modal (X button, scrim click, Escape, post-submit) with this.
//
// We replaced framer-motion's <AnimatePresence /> with this hook so we don't
// ship 35 KB of JS just to fade a dialog in and out.
export function useModalTransition(onClose: () => void, duration = 200) {
  const [shown, setShown] = useState(false);
  // Tracks an in-flight close so a second close request (Escape + scrim, etc.)
  // can't stack two unmount timers and fire onClose twice.
  const closingRef = useRef(false);

  useEffect(() => {
    // Defer the open flip to the next paint so CSS transition has a frame
    // to interpolate from `shown=false` styles.
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    setTimeout(onClose, duration);
  }, [onClose, duration]);

  return { shown, handleClose };
}
