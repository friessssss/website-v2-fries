"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useState, type RefObject } from "react";

type FluidCursorProps = {
  targetRef?: RefObject<HTMLElement>;
};

export default function FluidCursor({ targetRef }: FluidCursorProps) {
  const cursorX = useMotionValue(-400);
  const cursorY = useMotionValue(-400);
  const trailX = useMotionValue(-400);
  const trailY = useMotionValue(-400);
  const [active, setActive] = useState(false);

  const smoothX = useSpring(cursorX, { stiffness: 160, damping: 20, mass: 0.25 });
  const smoothY = useSpring(cursorY, { stiffness: 160, damping: 20, mass: 0.25 });
  const slowX = useSpring(trailX, { stiffness: 80, damping: 16, mass: 0.5 });
  const slowY = useSpring(trailY, { stiffness: 80, damping: 16, mass: 0.5 });

  useEffect(() => {
    const node = targetRef?.current;
    if (!node) return;

    const updatePosition = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const withinX = event.clientX >= rect.left && event.clientX <= rect.right;
      const withinY = event.clientY >= rect.top && event.clientY <= rect.bottom;

      if (!withinX || !withinY) {
        setActive(false);
        return;
      }

      setActive(true);
      const x = event.clientX - rect.left - 160;
      const y = event.clientY - rect.top - 160;
      cursorX.set(x);
      cursorY.set(y);
      trailX.set(x - 40);
      trailY.set(y - 40);
    };

    const handlePointerLeave = () => setActive(false);

    window.addEventListener("pointermove", updatePosition);
    window.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      window.removeEventListener("pointermove", updatePosition);
      window.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [cursorX, cursorY, targetRef, trailX, trailY]);

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-0 mix-blend-screen"
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="h-[260px] w-[260px] rounded-[40%] bg-gradient-to-br from-[#00ffd2] via-[#d0ff54] to-[#ff7bf1] opacity-40 blur-[120px]"
        style={{ x: smoothX, y: smoothY }}
      />
      <motion.div
        className="h-[340px] w-[340px] rounded-[45%] bg-gradient-to-br from-[#ffae00] via-transparent to-[#00d1ff] opacity-18 blur-[150px]"
        style={{ x: slowX, y: slowY }}
      />
    </motion.div>
  );
}

