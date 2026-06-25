// api/functions/update-db-and-create-static-page.ts
import { VercelRequest, VercelResponse } from "@vercel/node";
import { originConstGlobal, REPO_OWNER_GLOBAL } from "../../consts";
import { verify } from "jsonwebtoken";
import axios from "axios";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const REPO_OWNER = REPO_OWNER_GLOBAL;
const REPO_NAME = "reCollecTF";
const WORKFLOW_FILE_NAME = "update-db-and-create-page.yml";

function b64(str: string) {
  return Buffer.from(str, "utf8").toString("base64");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ whoami: "UPDATE-DB-AND-CREATE-STATIC-PAGE" });
  }

  const origin = originConstGlobal;
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

  const { sqlPath, expressionId, htmlContent, expressionInfo, uniprotAccession } = req.body || {};

  if (!sqlPath) {
    return res.status(400).json({ error: "Missing sqlPath" });
  }
  if (!expressionId || !/^EXPREG_[a-f0-9A-F]+$/.test(expressionId)) {
    return res.status(400).json({ error: "expressionId inválido o ausente" });
  }
  if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
    return res.status(400).json({ error: "htmlContent ausente o vacío" });
  }

  try {
    await axios.post(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE_NAME}/dispatches`,
      {
        ref: "main",
        inputs: {
          sql_path: sqlPath,
          expression_id: expressionId,
          html_content: b64(htmlContent),
          expressionInfo: String(expressionInfo),
          uniprot_accession: uniprotAccession || "",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: err?.message || "Unknown error" };
    return res.status(status).json({ error: "Failed to dispatch workflow", details: data });
  }

  return res.status(200).json({
    message: "Workflow dispatched",
    sql_path: sqlPath,
    expression_id: expressionId,
  });
}