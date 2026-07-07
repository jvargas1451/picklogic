import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOTTERY_API_TOKEN = Deno.env.get("LOTTERY_API_TOKEN");
const SUPABASE_URL = "https://jehqbmchbveyiqdvdyua.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("PICKLOGIC_SERVICE_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const GAMES = [
  { game: "pb", id: 1 },
  { game: "mm", id: 10 },
];

async function fetchLatestDraw(game) {
  const res = await fetch(
    `https://www.lotteryresultsfeed.com/api/lottery/results?id=${game.id}&limit=1`,
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

function toInt(n) {
  return typeof n === "number" ? n : parseInt(n, 10);
}

async function settleTickets(draw) {
  const drawNumbers = (draw.numbers || []).map(toInt);
  const drawSpecial = toInt(draw.special);

  const { data: openTickets, error: selectError } = await supabase
    .from("tickets")
    .select("id, numbers, special")
    .eq("game", draw.game)
    .eq("draw_date", draw.draw_date)
    .eq("status", "open");

  if (selectError) {
    console.error("Ticket select error:", selectError.message);
    return 0;
  }

  let settled = 0;
  for (const ticket of openTickets ?? []) {
    const matchedMain = (ticket.numbers ?? []).filter((n) =>
      drawNumbers.includes(toInt(n))
    ).length;
    const matchedSpecial = toInt(ticket.special) === drawSpecial;
    const status = matchedSpecial || matchedMain >= 3 ? "won" : "lost";

    const { error: updateError } = await supabase
      .from("tickets")
      .update({ status })
      .eq("id", ticket.id);

    if (updateError) {
      console.error(`Settle error for ticket ${ticket.id}:`, updateError.message);
    } else {
      settled++;
    }
  }

  return settled;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await Promise.all(GAMES.map(fetchLatestDraw));

  const saved = [];
  let settled = 0;

  for (const draw of results) {
    if (!draw) continue;

    const { error } = await supabase
      .from("draws")
      .upsert(draw, { onConflict: "game,draw_date" });

    if (error) {
      console.error("Upsert error:", error.message);
      continue;
    }

    console.log(`Saved: ${draw.game} ${draw.draw_date}`);
    saved.push(`${draw.game} ${draw.draw_date}`);
    settled += await settleTickets(draw);
  }

  return new Response(JSON.stringify({ ok: true, saved, settled }), {
    headers: { "Content-Type": "application/json" },
  });
});
