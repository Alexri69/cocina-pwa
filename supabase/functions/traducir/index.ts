// Cocina — Edge Function "traducir"
// Traduce del español al inglés y al alemán los nombres y descripciones de la carta
// usando DeepL (API Free). La clave nunca llega al navegador.
// "Verify JWT" ON: solo usuarios con sesión; además se exige ser propietario o
// encargado de algún restaurante.
// Secreto: DEEPL_API_KEY. (SUPABASE_URL y SUPABASE_ANON_KEY los inyecta Supabase.)
//
// Petición:  POST { textos: string[], idiomas?: ['en','de'] }
// Respuesta: { en: string[], de: string[] }  (mismo orden que `textos`)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON         = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEEPL_KEY    = Deno.env.get("DEEPL_API_KEY") || "";
// Las claves gratuitas de DeepL terminan en ":fx" y van a otro servidor
const DEEPL_URL = DEEPL_KEY.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";

const DESTINO: Record<string, string> = { en: "EN-GB", de: "DE" };
const MAX_TEXTOS = 200, MAX_CARACTERES = 20000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  // Sin clave: la app traduce con MyMemory desde el navegador (codigo "sin_deepl")
  if (!DEEPL_KEY) return json({ error: "Falta configurar la clave de DeepL en Supabase.", codigo: "sin_deepl" }, 503);

  // ¿Es propietario o encargado de algún restaurante? (con su propio token: lo filtra RLS)
  const auth = req.headers.get("Authorization") || "";
  const m = await fetch(`${SUPABASE_URL}/rest/v1/miembros?select=rol&rol=in.(propietario,encargado)&limit=1`, {
    headers: { apikey: ANON, Authorization: auth },
  });
  const filas = await m.json().catch(() => []);
  if (!m.ok || !Array.isArray(filas) || !filas.length) {
    return json({ error: "Solo el propietario o el encargado pueden traducir la carta." }, 403);
  }

  const cuerpo = await req.json().catch(() => null);
  const textos: string[] = Array.isArray(cuerpo?.textos) ? cuerpo.textos.map((t: unknown) => String(t ?? "")) : [];
  const idiomas: string[] = (Array.isArray(cuerpo?.idiomas) ? cuerpo.idiomas : ["en", "de"]).filter((l: string) => DESTINO[l]);
  if (!textos.length || !idiomas.length) return json({ error: "Nada que traducir." }, 400);
  if (textos.length > MAX_TEXTOS || textos.join("").length > MAX_CARACTERES) {
    return json({ error: "Demasiado texto de una vez." }, 413);
  }

  const resultado: Record<string, string[]> = {};
  for (const l of idiomas) {
    // Los vacíos no se envían (DeepL los cobra igual y no aportan nada)
    const indices = textos.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
    const salida = textos.map(() => "");
    if (indices.length) {
      const r = await fetch(DEEPL_URL, {
        method: "POST",
        headers: { Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: indices.map((i) => textos[i]),
          source_lang: "ES",
          target_lang: DESTINO[l],
          context: "Carta de un restaurante: nombres y descripciones de platos y bebidas.",
          preserve_formatting: true,
        }),
      });
      if (r.status === 456) return json({ error: "Se ha agotado el cupo gratuito de DeepL de este mes." }, 429);
      if (r.status === 403) return json({ error: "La clave de DeepL no es válida." }, 502);
      if (!r.ok) return json({ error: `DeepL respondió ${r.status}.` }, 502);
      const d = await r.json();
      (d.translations || []).forEach((t: { text: string }, k: number) => { salida[indices[k]] = t.text; });
    }
    resultado[l] = salida;
  }
  return json(resultado);
});
