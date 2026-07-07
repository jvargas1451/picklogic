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

async function settleOpenTickets() {
  const { data: openTickets, error: ticketError } = await supabase
    .from("tickets")
    .select("id, game, draw_date, numbers, special")
    .eq("status", "open");

  if (ticketError) {
    console.error("Ticket select error:", ticketError.message);
    return 0;
  }
  if (!openTickets || openTickets.length === 0) return 0;

  const { data: draws, error: drawsError } = await supabase
    .from("draws")
    .select("game, draw_date, numbers, special");

  if (drawsError) {
    console.error("Draws select error:", drawsError.message);
    return 0;
  }

  const drawByKey = new Map(
    (draws ?? []).map((d) => [`${d.game}_${d.draw_date}`, d])
  );

  let settled = 0;
  for (const ticket of openTickets) {
    const draw = drawByKey.get(`${ticket.game}_${ticket.draw_date}`);
    if (!draw) continue;

    const drawNumbers = (draw.numbers || []).map(toInt);
    const drawSpecial = toInt(draw.special);
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
  }

  const settled = await settleOpenTickets();

  return new Response(JSON.stringify({ ok: true, saved, settled }), {
    headers: { "Content-Type": "application/json" },
  });
});
