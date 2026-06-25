import whatsappHandler from "../../whatsapp.js";

export default async function handler(req, res) {
  req.query = { ...(req.query || {}), resource: "webhook" };
  return whatsappHandler(req, res);
}
