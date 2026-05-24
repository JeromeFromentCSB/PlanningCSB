/**
 * api/axonaut.js — Proxy Vercel pour l'API Axonaut
 *
 * Pourquoi un proxy ? L'API Axonaut bloque les appels directs depuis
 * un navigateur (CORS). Cette fonction tourne côté serveur Vercel,
 * où la clé API est sécurisée dans les variables d'environnement.
 *
 * Usage depuis PlanBrod :
 *   fetch('/api/axonaut?endpoint=opportunities')
 *   fetch('/api/axonaut?endpoint=companies')
 */
export default async function handler(req, res) {
  // CORS — autorise les appels depuis votre domaine Vercel
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.AXONAUT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Clé API Axonaut manquante. Ajoutez AXONAUT_API_KEY dans Vercel → Settings → Environment Variables."
    });
  }

  const { endpoint, ...queryParams } = req.query;
  if (!endpoint) return res.status(400).json({ error: "Paramètre 'endpoint' requis." });

  // Construire l'URL avec les éventuels paramètres de filtre
  const params = new URLSearchParams(queryParams).toString();
  const url = `https://axonaut.com/api/v2/${endpoint}${params ? "?" + params : ""}`;

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: {
        userApiKey: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: req.method !== "GET" ? JSON.stringify(req.body) : undefined,
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: "Erreur proxy : " + e.message });
  }
}
