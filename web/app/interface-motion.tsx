"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import type { ReactNode } from "react";

export const interfaceEase = [0.22, 1, 0.36, 1] as const;

export const pageEntranceInitial = {
  opacity: 0,
  y: 10,
};

export const pageEntranceTarget = {
  opacity: 1,
  y: 0,
};

export const sectionItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 8,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.34,
      ease: interfaceEase,
    },
  },
};

export function pageEntranceMotion(reducedMotion: boolean | null) {
  return {
    animate: pageEntranceTarget,
    initial: reducedMotion ? false : pageEntranceInitial,
    transition: reducedMotion
      ? { duration: 0 }
      : { duration: 0.36, ease: interfaceEase },
  };
}

export function sectionCascadeVariants(
  reducedMotion: boolean | null,
): Variants {
  return {
    hidden: {},
    visible: {
      transition: reducedMotion
        ? { delayChildren: 0, staggerChildren: 0 }
        : { delayChildren: 0.05, staggerChildren: 0.055 },
    },
  };
}

export function MotionHandoff({
  children,
  className,
  loading,
  skeleton,
}: {
  children: ReactNode;
  className?: string;
  loading: boolean;
  skeleton: ReactNode;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={className}
        data-motion-state={loading ? "loading" : "ready"}
        exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
        initial={reducedMotion ? false : { opacity: 0, y: 5 }}
        key={loading ? "loading" : "ready"}
        transition={reducedMotion
          ? { duration: 0 }
          : { duration: 0.22, ease: interfaceEase }}
      >
        {loading ? skeleton : children}
      </motion.div>
    </AnimatePresence>
  );
}
