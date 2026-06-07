// api/functions/dispatch-and-create.ts
import { VercelRequest, VercelResponse } from "@vercel/node";
import { verify } from "jsonwebtoken";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const BASE_URL = "https://recollectf2.vercel.app/api/functions";
const REPO_OWNER = "ErillLab";
const REPO_NAME = "reCollecTF";

// Polling: espera a que el run de update-db.yml que usa sql_path acabe con éxito
async function waitForUpdateDB(sqlPath: string, timeoutMs = 55000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  // Da tiempo a GitHub a registrar el run (~3s)
  await new Promise(r => setTimeout(r, 3000));

  while (Date.now() < deadline) {
    const runsRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/update-db.yml/runs?per_page=10&branch=main`,
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    const runs = await runsRes.json();
    const run = runs.workflow_runs?.find((r: any) =>
      r.display_title?.includes(sqlPath) || r.head_commit?.message?.includes(sqlPath)
    );

    if (run) {
      if (run.status === "completed") {
        if (run.conclusion === "success") return;
        throw new Error(`Update DB failed with conclusion: ${run.conclusion}`);
      }
    }

    await new Promise(r => setTimeout(r, 4000));
  }

  throw new Error("Timeout: Update DB workflow did not complete in time");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ whoami: "DISPATCH-AND-CREATE" });
  }

  const origin = "https://alexhernandezcortacans.github.io";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed." });

  // Auth
  const cookies = parse(req.headers.cookie || "");
  const token = cookies["session_token"];
  if (!token) return res.status(401).json({ error: "No session token" });

  try {
    verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }

  const { inputs, expressionId, htmlContent, expressionInfo, uniprotAccession } = req.body || {};

  if (!inputs?.queries) {
    return res.status(400).json({ error: "Missing inputs.queries" });
  }
  if (!expressionId || !htmlContent) {
    return res.status(400).json({ error: "Missing expressionId or htmlContent" });
  }

  const cookieHeader = req.headers.cookie || "";

  // 1) send-form
  let sendFormPayload: any;
  try {
    const sendFormRes = await fetch(`${BASE_URL}/send-form`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieHeader },
      body: JSON.stringify({ inputs }),
    });

    const text = await sendFormRes.text();
    try { sendFormPayload = text ? JSON.parse(text) : null; } catch { sendFormPayload = text; }

    if (!sendFormRes.ok) {
      return res.status(sendFormRes.status).json({ error: "send-form failed", details: sendFormPayload });
    }
  } catch (err: any) {
    return res.status(500).json({ error: "send-form threw an exception", details: err.message });
  }

  // 2) Esperar a que Update DB termine
  try {
    await waitForUpdateDB(sendFormPayload.sql_path);
  } catch (err: any) {
    return res.status(500).json({ error: "Update DB workflow did not complete successfully", details: err.message });
  }

  // 3) create-expression-page
  let createPayload: any;
  try {
    const createRes = await fetch(`${BASE_URL}/create-expression-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieHeader },
      body: JSON.stringify({ expressionId, htmlContent, expressionInfo, uniprotAccession }),
    });

    const text = await createRes.text();
    try { createPayload = text ? JSON.parse(text) : null; } catch { createPayload = text; }

    if (!createRes.ok) {
      return res.status(createRes.status).json({ error: "create-expression-page failed", details: createPayload });
    }
  } catch (err: any) {
    return res.status(500).json({ error: "create-expression-page threw an exception", details: err.message });
  }

  return res.status(200).json({
    message: "Both workflows dispatched successfully",
    sendForm: sendFormPayload,
    createExpressionPage: createPayload,
  });
}