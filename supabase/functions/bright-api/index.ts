import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOTTERY_API_TOKEN = Deno.env.get("LOTTERY_API_TOKEN");
const SUPABASE_URL = "https://jehqbmchbveyiqdvdyua.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("PICKLOGIC_SERVICE_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const GAMES = [
  { game: "pb", id: 1 },
  { game: "mm", id: 10 },
];

async function fetchLatestDraw(game) {
  const params = game.id
    ? `id=${game.id}&limit=1`
    : `slug=${game.slug}&country=${game.country}&limit=1`;

  const res = await fetch(
    `https://www.lotteryresultsfeed.com/api/lottery/results?${params}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${LOTTERY_API_TOKEN}`,
      },
    }
  );

  const data = await res.json();
  const result = data.results?.[0];
  if (!result) return null;

  return {
    game: game.game,
    draw_date: result.draw_date,
    numbers: result.balls,
    special: result.ball_bonus,
    jackpot: result.jackpot || 0,
  };
}

Deno.serve(async () => {
  const results = await Promise.all(GAMES.map(fetchLatestDraw));

  for (const draw of results) {
    if (!draw) continue;

    const { error } = await supabase
      .from("draws")
      .upsert(draw, { onConflict: "game,draw_date" });

    if (error) console.error("Upsert error:", error.message);
    else console.log(`Saved: ${draw.game} ${draw.draw_date}`);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});