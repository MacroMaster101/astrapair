"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Heart,
  HeartHandshake,
  MessageCircle,
  Moon,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import { Reveal } from "./reveal";
import { useReducedMotion } from "./use-reduced-motion";

const READINGS = [
  {
    icon: MessageCircle,
    title: "Communication",
    heading: "Understand how you hear each other.",
    body: "The way you say it matters. Explore how your Mercury placements shape the way you talk, listen, and work through a difference.",
    question: "What helps each of us feel heard?",
    factor: "Mercury placements & aspects",
  },
  {
    icon: Moon,
    title: "Emotional needs",
    heading: "Make room for what you both need.",
    body: "Your Moon placements offer a way to reflect on comfort, vulnerability, and the little things that help each of you feel at home.",
    question: "What makes each of us feel safe?",
    factor: "Moon placements & aspects",
  },
  {
    icon: Heart,
    title: "Attraction",
    heading: "Explore what draws you together.",
    body: "Look at Venus and Mars across your charts to reflect on affection, chemistry, and the ways you each express desire.",
    question: "How do we each show affection?",
    factor: "Venus & Mars across both charts",
  },
  {
    icon: HeartHandshake,
    title: "Conflict and repair",
    heading: "Find your way back to each other.",
    body: "Understand the chart patterns behind friction. Use your differences as a starting point for talking about what repair looks like for both of you.",
    question: "What helps us reconnect after a disagreement?",
    factor: "Challenging aspects & shared patterns",
  },
  {
    icon: Sparkles,
    title: "Questions for each other",
    heading: "Let insight become a conversation.",
    body: "Every reading includes prompts to explore together. Ask the assistant a follow-up question grounded in your actual placements.",
    question: "What could we understand better about each other?",
    factor: "Conversation prompts from your charts",
  },
];

export function ReadingExplorer() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  return (
    <Reveal className="reading-layout">
      <motion.div
        className="reading-image"
        initial={reduced ? false : { opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        <Image
          src="/images/together-under-stars.png"
          alt="A couple sharing a quiet moment beside the sea under a starry blue sky"
          fill
          sizes="(max-width: 767px) 100vw, 45vw"
          className="object-cover"
        />
      </motion.div>
      <div className="reading-content">
        <div
          className="reading-tabs"
          role="tablist"
          aria-label="What your reading covers"
          aria-orientation="horizontal"
        >
          {READINGS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              id={`reading-tab-${index}`}
              aria-selected={active === index}
              aria-controls={`reading-panel-${index}`}
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % READINGS.length;
                else if (event.key === "ArrowLeft")
                  next = (index - 1 + READINGS.length) % READINGS.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = READINGS.length - 1;
                else return;
                event.preventDefault();
                setActive(next);
                document.getElementById(`reading-tab-${next}`)?.focus();
              }}
            >
              <item.icon aria-hidden size={16} strokeWidth={1.5} />
              <span>{item.title}</span>
            </button>
          ))}
        </div>
        {READINGS.map((reading, index) => (
          <motion.div
            role="tabpanel"
            id={`reading-panel-${index}`}
            aria-labelledby={`reading-tab-${index}`}
            tabIndex={0}
            className="reading-panel"
            key={index}
            hidden={active !== index}
            initial={false}
            animate={{
              opacity: active === index ? 1 : 0,
              y: reduced || active === index ? 0 : 12,
            }}
            transition={{ duration: reduced ? 0 : 0.4 }}
          >
            <p className="reading-factor">{reading.factor}</p>
            <h3>{reading.heading}</h3>
            <p>{reading.body}</p>
            <div className="conversation-prompt">
              <span>A conversation to start</span>
              <p>“{reading.question}”</p>
              <ArrowRight aria-hidden size={20} />
            </div>
          </motion.div>
        ))}
      </div>
    </Reveal>
  );
}
