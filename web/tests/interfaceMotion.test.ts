import { describe, expect, it } from "vitest";

import {
  pageEntranceInitial,
  pageEntranceMotion,
  pageEntranceTarget,
  sectionCascadeVariants,
  sectionItemVariants,
} from "../app/interface-motion";

describe("interface motion", () => {
  it("uses a restrained page settle without scale or bounce", () => {
    const motion = pageEntranceMotion(false);

    expect(motion.initial).toEqual(pageEntranceInitial);
    expect(motion.animate).toEqual(pageEntranceTarget);
    expect(pageEntranceInitial).toEqual({ opacity: 0, y: 10 });
    expect(pageEntranceTarget).toEqual({ opacity: 1, y: 0 });
    expect(motion.transition).toMatchObject({ duration: 0.36 });
  });

  it("cascades only explicitly marked major sections", () => {
    const variants = sectionCascadeVariants(false);

    expect(variants.visible).toMatchObject({
      transition: {
        delayChildren: 0.05,
        staggerChildren: 0.055,
      },
    });
    expect(sectionItemVariants.hidden).toEqual({ opacity: 0, y: 8 });
  });

  it("removes spatial movement and delay for reduced-motion users", () => {
    expect(pageEntranceMotion(true)).toMatchObject({
      initial: false,
      transition: { duration: 0 },
    });
    expect(sectionCascadeVariants(true).visible).toMatchObject({
      transition: {
        delayChildren: 0,
        staggerChildren: 0,
      },
    });
  });
});
