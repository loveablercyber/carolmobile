import { promises as fs } from "node:fs";
import { join } from "node:path";

async function walk(dir) {
  let files = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of list) {
    const res = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== ".vercel" && entry.name !== "dist") {
        files = files.concat(await walk(res));
      }
    } else {
      files.push(res);
    }
  }
  return files;
}

async function main() {
  const files = await walk("c:\\Users\\carol\\OneDrive\\Área de Trabalho\\site mobile carol");
  for (const file of files) {
    if (file.endsWith(".tsx") || file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".mjs")) {
      const content = await fs.readFile(file, "utf8");
      if (content.includes("WhatsAppIntegration")) {
        console.log(`Found in: ${file}`);
      }
    }
  }
}

main();
