// test-evolution-send.mjs
import "dotenv/config";

const url = process.env.EVOLUTION_API_URL;
const instance = "fastdevbuilds";
const apiKey = "fastdevbuilds_evo_2025";
const phone = "5517992005945";

if (!url) {
  console.error("Falta EVOLUTION_API_URL no .env");
  process.exit(1);
}

console.log("=== 1. Estado da instância ===");
const stateRes = await fetch(`${url}/instance/connectionState/${instance}`, {
  headers: { apikey: apiKey },
});
console.log("HTTP:", stateRes.status);
console.log("Body:", await stateRes.text());

console.log("\n=== 2. Número existe no WhatsApp? ===");
const checkRes = await fetch(`${url}/chat/whatsappNumbers/${instance}`, {
  method: "POST",
  headers: { apikey: apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ numbers: [phone] }),
});
console.log("HTTP:", checkRes.status);
console.log("Body:", await checkRes.text());

console.log("\n=== 3. Envio de teste ===");
const sendRes = await fetch(`${url}/message/sendText/${instance}`, {
  method: "POST",
  headers: { apikey: apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    number: phone,
    textMessage: { text: "diag evolution " + new Date().toISOString() },
  }),
});
console.log("HTTP:", sendRes.status);
console.log("Body:", await sendRes.text());
