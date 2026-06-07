// api/functions/dispatch-and-create.ts
import { VercelRequest, VercelResponse } from "@vercel/node";
import { verify } from "jsonwebtoken";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;
const BASE_URL = "https://recollectf2.vercel.app/api/functions";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ whoami: "DISPATCH-AND-CREATE" });
  }

  // CORS
  // const origin = "https://collectf.org"; change in merge
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

  // Params
  const { inputs, expressionId, htmlContent, expressionInfo, uniprotAccession } = req.body || {};

  if (!inputs?.queries) {
    return res.status(400).json({ error: "Missing inputs.queries" });
  }
  if (!expressionId || !htmlContent) {
    return res.status(400).json({ error: "Missing expressionId or htmlContent" });
  }

  // Sends session cookie to internal functions
  const cookieHeader = req.headers.cookie || "";

  // 1) send-form
  let sendFormPayload: any;
  try {
    const sendFormRes = await fetch(`${BASE_URL}/send-form`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieHeader,
      },
      body: JSON.stringify({ inputs }),
    });

    const text = await sendFormRes.text();
    try { sendFormPayload = text ? JSON.parse(text) : null; } catch { sendFormPayload = text; }

    if (!sendFormRes.ok) {
      return res.status(sendFormRes.status).json({
        error: "send-form failed",
        details: sendFormPayload,
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: "send-form threw an exception", details: err.message });
  }

  // 2) create-expression-page (only if sendForm was successful)
  let createPayload: any;
  try {
    const createRes = await fetch(`${BASE_URL}/create-expression-page`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieHeader,
      },
      body: JSON.stringify({ expressionId, htmlContent, expressionInfo, uniprotAccession }),
    });

    const text = await createRes.text();
    try { createPayload = text ? JSON.parse(text) : null; } catch { createPayload = text; }

    if (!createRes.ok) {
      return res.status(createRes.status).json({
        error: "create-expression-page failed",
        details: createPayload,
      });
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