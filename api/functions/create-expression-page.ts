// api/functions/create-expression-page.ts
import { VercelRequest, VercelResponse } from "@vercel/node";
import { verify } from "jsonwebtoken";
import axios from "axios";
import { parse } from "cookie";


const BOT_TOKEN = process.env.BOT_TOKEN!;
const JWT_SECRET = process.env.JWT_SECRET!;
const REPO_OWNER = 'ErillLab';
const REPO_NAME = 'reCollecTF';

const WORKFLOW_FILE_NAME = "create-expression-page.yml";

function b64(str: string) {
  return Buffer.from(str, "utf8").toString("base64");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return res.status(200).json({ whoami: "CREATE-EXPRESSION-PAGE" });
  }

  const origin = "https://collectf.org"; // change in dev
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
const { expressionId, htmlContent, expressionInfo, uniprotAccession } = req.body || {};

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

    return res.status(200).json({
      message: "Workflow dispatched",
      expression_id: expressionId,
      path: `public/${expressionId}/index.html`,
    });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: err?.message || "Unknown error" };
    console.error("CREATE-EXPRESSION-PAGE ERROR:", status, data);
    return res.status(status).json({ error: "CREATE-EXPRESSION-PAGE ERROR", details: data });
  }
}