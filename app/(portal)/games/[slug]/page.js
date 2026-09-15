import { notFound } from "next/navigation";

import HarakahLab from "@/components/games/HarakahLab";
import HearTouch from "@/components/games/HearTouch";
import ThreePlaces from "@/components/games/ThreePlaces";
import TraceSay from "@/components/games/TraceSay";
import WordBlend from "@/components/games/WordBlend";
import { requireSession } from "@/lib/dal";
import { GAMES, game } from "@/lib/games/catalogue";

const COMPONENTS = {
  "trace-say": TraceSay,
  "harakah-lab": HarakahLab,
  "hear-touch": HearTouch,
  "three-places": ThreePlaces,
  "word-blend": WordBlend,
};

export function generateStaticParams() {
  return GAMES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const g = game(slug);
  return { title: g ? g.title : "Games" };
}

/**
 * One game, full screen.
 *
 * The route stays inside the authenticated portal layout — the game's own shell
 * covers the chrome rather than escaping it, so there is no second session or
 * auth path to get wrong.
 */
export default async function GamePage({ params }) {
  await requireSession();
  const { slug } = await params;
  const Game = COMPONENTS[slug];
  if (!Game) notFound();
  return <Game />;
}
