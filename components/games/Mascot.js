"use client";

/**
 * The LQK ustaz and ustazah, lifted from the flashcard deck so the character on
 * the screen is the one on the printed card.
 *
 * They react rather than decorate: idle while a child works, a bounce when a
 * letter lands, a small shake on a wrong pick. Deliberately small and pinned to
 * a corner — the letter is the thing being looked at, and a cheering cartoon in
 * the middle of the screen would compete with it.
 *
 * The keyframes live in app/globals.css beside lqk-rise, which is where this
 * portal keeps its animations.
 */

const SRC = {
  ustaz: "/huruf/mascot-ustaz.png",
  ustazah: "/huruf/mascot-ustazah.png",
};

const MOOD = {
  cheer: "lqk-cheer",
  oops: "lqk-oops",
  idle: "",
};

/**
 * `beat` retriggers the animation: a CSS animation only runs when the class
 * arrives, so a second cheer in a row needs the element remounted. Callers pass
 * a counter that goes up on every event worth reacting to.
 */
export default function Mascot({ who = "ustaz", mood = "idle", beat = 0, className = "" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={`${mood}-${beat}`}
      src={SRC[who] ?? SRC.ustaz}
      alt=""
      aria-hidden="true"
      className={`pointer-events-none select-none object-contain ${MOOD[mood] ?? ""} ${className}`}
    />
  );
}
