"use client";
import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import DigitalLoomBackground from "@/components/ui/digital-loom-background";

const fadeUpVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.2,
      duration: 1,
      ease: [0.25, 0.1, 0.25, 1.0] as const,
    },
  }),
};

const TYPING_TEXTS = ["Second Brain.", "Take your thoughts"];

const TypingText = () => {
  const [textIndex, setTextIndex] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = TYPING_TEXTS[textIndex];
    let timeout: NodeJS.Timeout;

    if (!isDeleting && displayed.length < current.length) {
      timeout = setTimeout(() => {
        setDisplayed(current.slice(0, displayed.length + 1));
      }, 80);
    } else if (!isDeleting && displayed.length === current.length) {
      timeout = setTimeout(() => setIsDeleting(true), 2000);
    } else if (isDeleting && displayed.length > 0) {
      timeout = setTimeout(() => {
        setDisplayed(current.slice(0, displayed.length - 1));
      }, 40);
    } else if (isDeleting && displayed.length === 0) {
      setIsDeleting(false);
      setTextIndex((prev) => (prev + 1) % TYPING_TEXTS.length);
    }

    return () => clearTimeout(timeout);
  }, [displayed, isDeleting, textIndex]);

  return (
    <span>
      {displayed}
      <span className="animate-pulse">|</span>
    </span>
  );
};

const DemoOne = () => {
  return (
    <DigitalLoomBackground>
      <div className="text-center max-w-4xl mx-auto px-4">
        <motion.div
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          custom={0}
          className="mb-6 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-6 py-2 text-sm text-white/80 backdrop-blur-md"
        >
          Forgetting Things Again?
        </motion.div>

        <motion.h1
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          custom={1}
className="text-5xl font-bold tracking-tight text-white sm:text-7xl md:text-8xl whitespace-nowrap"        >
          <TypingText />
        </motion.h1>

        <motion.p
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          custom={2}
          className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-white/60"
        >
          You can't see your brain — So thoughts scatter, tasks slip away.
          <br />
          Second Brain makes your thinking visible
        </motion.p>

        <motion.div
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
          custom={3}
          className="mt-12 flex items-center justify-center gap-x-6"
        >
          <button className="rounded-full bg-white px-8 py-4 text-lg font-semibold text-black shadow-lg shadow-white/20 transition-transform hover:scale-105">
            Build Your Second Brain
          </button>
        </motion.div>
      </div>
    </DigitalLoomBackground>
  );
};

export default DemoOne;