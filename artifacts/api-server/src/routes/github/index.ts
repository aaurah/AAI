import { Router } from "express";

const router = Router();

router.post("/github/device/code", async (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: "clientId required" });

  try {
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, scope: "repo read:user" }),
    });
    const data = await response.json() as Record<string, unknown>;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to contact GitHub" });
  }
});

router.post("/github/device/token", async (req, res) => {
  const { clientId, deviceCode } = req.body;
  if (!clientId || !deviceCode) return res.status(400).json({ error: "clientId and deviceCode required" });

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to contact GitHub" });
  }
});

export default router;
