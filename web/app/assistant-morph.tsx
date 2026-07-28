"use client";

import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
} from "motion/react";
import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { sharedSurfaceTransition } from "./interface-motion";

type AssistantMorphProps = {
  children: ReactNode;
  closeButtonClassName: string;
  icon: ReactNode;
  label: string;
  launcherClassName: string;
  launcherIdentityClassName: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  panelClassName: string;
  panelContentClassName: string;
  panelHeaderClassName: string;
  panelIdentityClassName: string;
  subtitle?: string;
  surfaceId: string;
  titleId?: string;
};

// Shared-surface pattern adapted from Motion's maintained Create Button and
// layout animation guides: https://motion.dev/examples/react-create-button
export function AssistantMorph({
  children,
  closeButtonClassName,
  icon,
  label,
  launcherClassName,
  launcherIdentityClassName,
  onOpenChange,
  open,
  panelClassName,
  panelContentClassName,
  panelHeaderClassName,
  panelIdentityClassName,
  subtitle,
  surfaceId,
  titleId: providedTitleId,
}: AssistantMorphProps) {
  const reduceMotion = useReducedMotion();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelId = `${surfaceId}-panel`;
  const titleId = providedTitleId ?? `${surfaceId}-title`;
  const layoutTransition = sharedSurfaceTransition(Boolean(reduceMotion));

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      closeRef.current?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  return (
    <MotionConfig reducedMotion="user" transition={layoutTransition}>
      <AnimatePresence
        initial={false}
        mode="popLayout"
        onExitComplete={() => launcherRef.current?.focus({ preventScroll: true })}
      >
        {!open ? (
          <motion.button
            aria-controls={panelId}
            aria-expanded="false"
            aria-label={`Open ${label}`}
            className={launcherClassName}
            key={`${surfaceId}-launcher`}
            layoutId={surfaceId}
            onClick={() => onOpenChange(true)}
            ref={launcherRef}
            style={{
              backgroundColor: "#24252a",
              borderRadius: 999,
            }}
            transition={layoutTransition}
            type="button"
            whileHover={{
              backgroundColor: "#393a40",
              scale: reduceMotion ? 1 : 1.015,
            }}
            whileTap={{ scale: reduceMotion ? 1 : 0.985 }}
          >
            <motion.span
              className={launcherIdentityClassName}
              layoutId={`${surfaceId}-identity`}
              style={{ color: "#ffffff" }}
              transition={layoutTransition}
            >
              {icon}
              <span>{label}</span>
            </motion.span>
          </motion.button>
        ) : (
          <motion.aside
            aria-labelledby={titleId}
            className={panelClassName}
            id={panelId}
            key={`${surfaceId}-panel`}
            layoutId={surfaceId}
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "20px 0 0 20px",
            }}
            transition={layoutTransition}
          >
            <header className={panelHeaderClassName}>
              <motion.div
                className={panelIdentityClassName}
                layout="position"
                layoutId={`${surfaceId}-identity`}
                style={{ color: "#292a30" }}
                transition={layoutTransition}
              >
                {icon}
                <div>
                  <h2 id={titleId}>{label}</h2>
                  {subtitle ? <small>{subtitle}</small> : null}
                </div>
              </motion.div>
              <motion.button
                aria-label={`Close ${label}`}
                className={closeButtonClassName}
                initial={reduceMotion ? false : { opacity: 0, rotate: -8, scale: 0.82 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, rotate: 8, scale: 0.82 }}
                onClick={() => onOpenChange(false)}
                ref={closeRef}
                transition={reduceMotion
                  ? { duration: 0 }
                  : { delay: 0.18, duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                type="button"
              >
                <X />
              </motion.button>
            </header>
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className={panelContentClassName}
              exit={reduceMotion ? undefined : { opacity: 0, x: 14 }}
              initial={reduceMotion ? false : { opacity: 0, x: 22 }}
              transition={reduceMotion
                ? { duration: 0 }
                : { delay: 0.16, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </motion.aside>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
