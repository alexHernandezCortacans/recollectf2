// api/functions/dispatch-and-create.ts
import { VercelRequest, VercelResponse } from "@vercel/node";
import { verify } from "jsonwebtoken";
import axios from "axios";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET!;
const BOT_TOKEN = process.env.BOT_TOKEN!;
const REPO_OWNER = "alexHernandezCortacans";
const REPO_NAME = "reCollecTF";
const WORKFLOW_FILE_NAME = "update-db-and-create-page.yml";

function b64(str: string) {
  return Buffer.from(str, "utf8").toString("base64");
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

  // Params
  const { inputs, expressionId, htmlContent, expressionInfo, uniprotAccession } = req.body || {};

  if (!inputs?.queries) {
    return res.status(400).json({ error: "Missing inputs.queries" });
  }
  if (!expressionId || !/^EXPREG_[a-f0-9A-F]+$/.test(expressionId)) {
    return res.status(400).json({ error: "expressionId inválido o ausente" });
  }
  if (!htmlContent || typeof htmlContent !== "string" || !htmlContent.trim()) {
    return res.status(400).json({ error: "htmlContent ausente o vacío" });
  }

  // 1) Crear el archivo SQL en el repo (igual que send-form)
  const safeTs = new Date().toISOString().replace(/[:.]/g, "-");
  const sqlPath = `pending-sql/${safeTs}.sql`;

  try {
    // Crear el archivo SQL en el repo
    await axios.put(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(sqlPath)}`,
      {
        message: `Add SQL for workflow: ${sqlPath}`,
        content: b64(inputs.queries),
        branch: "main",
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
    return res.status(status).json({ error: "Failed to create SQL file", details: data });
  }

  // 2) Disparar el workflow unificado con todos los parámetros
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