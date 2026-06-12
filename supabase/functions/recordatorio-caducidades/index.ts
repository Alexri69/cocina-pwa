// Cocina — Edge Function programada "recordatorio-caducidades"
// Cada día revisa los productos próximos a caducar / caducados y envía un push
// a los dispositivos del usuario (aunque la app esté cerrada).
// "Verify JWT" debe estar OFF. Secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   CRON_SECRET (opcional, para proteger el endpoint).
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solos.)

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET  = Deno.env.get("CRON_SECRET") || "";

webpush.setVapidDetails(
  "mailto:cocina@app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

  const hoy = new Date().toISOString().slice(0, 10);
  const lim = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10); // hoy + 2 días

  // Productos caducados o que caducan en <= 2 días
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/productos?select=user_id,nombre,lote,fecha_caducidad&fecha_caducidad=lte.${lim}`,
    { headers: H },
  );
  const prods = await r.json().catch(() => []);
  if (!Array.isArray(prods)) return json({ error: "consulta fallida" });

  // Agrupar por usuario
  const byUser: Record<string, { cad: number; prox: number }> = {};
  for (const p of prods) {
    const u = (byUser[p.user_id] ??= { cad: 0, prox: 0 });
    if ((p.fecha_caducidad || "") < hoy) u.cad++; else u.prox++;
  }

  let enviados = 0;
  for (const uid of Object.keys(byUser)) {
    const { cad, prox } = byUser[uid];
    if (!cad && !prox) continue;
    const partes: string[] = [];
    if (cad)  partes.push(`${cad} caducado${cad > 1 ? "s" : ""}`);
    if (prox) partes.push(`${prox} próximo${prox > 1 ? "s" : ""} a caducar`);

    const subsR = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${uid}&select=endpoint,p256dh,auth`,
      { headers: H },
    );
    const subs = await subsR.json().catch(() => []);
    const payload = JSON.stringify({
      title: "🍽 Cocina — Caducidades",
      body:  partes.join(" · "),
      url:   "./index.html?m=etiquetas",
    });

    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        enviados++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
            method: "DELETE", headers: H,
          });
        }
      }
    }
  }
  return json({ ok: true, usuarios: Object.keys(byUser).length, enviados });
});
