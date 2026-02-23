import fs from "fs";
import path from "path";
import { chromium } from "playwright";

function sanitize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function formatPriceBR(value) {
  // tenta transformar "R$ 199.90" ou "199,90" em "199,90"
  const s = String(value || "").replace(/[^\d,.\-]/g, "");
  if (!s) return "";
  // se tem vírgula, assume decimal BR
  if (s.includes(",")) {
    const cleaned = s.replace(/\./g, "");
    const [a, b = "00"] = cleaned.split(",");
    return `${a},${b.padEnd(2, "0").slice(0, 2)}`;
  }
  // senão usa ponto como decimal
  const num = Number(s);
  if (Number.isFinite(num)) {
    return num.toFixed(2).replace(".", ",");
  }
  return "";
}

export async function runCrawl({ url, username, password, maxItems, delayMs, csvPath, imgDir }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // tentativa simples de login (heurística)
  const hasPassword = await page.locator('input[type="password"]').count().catch(() => 0);
  if (hasPassword && username && password) {
    // tenta achar um input de usuário/email
    const userInput =
      page.locator('input[type="email"]').first()
        .or(page.locator('input[name*="user" i], input[name*="email" i], input[id*="email" i], input[id*="user" i]').first());

    const passInput = page.locator('input[type="password"]').first();

    await userInput.fill(username).catch(() => {});
    await passInput.fill(password).catch(() => {});

    // tenta achar botão entrar
    const btn =
      page.locator('button:has-text("Entrar"), button:has-text("Login"), button:has-text("Sign in"), input[type="submit"]').first();

    await btn.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  }

  // rolagem para carregar (scroll infinito)
  let lastHeight = 0;
  for (let i = 0; i < 30; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
    if (h === lastHeight) break;
    lastHeight = h;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(delayMs);
  }

  // tentativa genérica de capturar cards de produto
  // pega elementos que tenham imagem + algum texto de preço
  const items = await page.evaluate(() => {
    const priceRegex = /(R\$|\$|€)\s*\d+|(\d+([.,]\d{2}))/;
    const nodes = Array.from(document.querySelectorAll("a, div, li, article"));
    const results = [];
    for (const el of nodes) {
      const img = el.querySelector("img");
      if (!img) continue;
      const txt = (el.innerText || "").trim();
      if (!txt || txt.length < 4) continue;
      if (!priceRegex.test(txt)) continue;

      const name = txt.split("\n").map(s => s.trim()).filter(Boolean)[0] || "";
      const imgUrl = img.currentSrc || img.src || "";

      // tenta achar preço no texto
      const m = txt.match(/(R\$|\$|€)?\s*\d{1,5}([.,]\d{2})/);
      const price = m ? m[0] : "";

      // tenta usar href se for link
      const href = el.getAttribute("href") || el.querySelector("a")?.getAttribute("href") || "";

      results.push({ name, price, imgUrl, href });
      if (results.length >= 800) break;
    }
    return results;
  });

  const sliced = items.slice(0, maxItems);

  // cabeçalho do CSV exigido
  const header = "id;nome;descricao;preco;estoque;categoria;sku;tamanhos;cores;sabores;estoque_variantes;imagem\n";
  const lines = [header];

  let idx = 1;
  for (const it of sliced) {
    const sku = `AUTO-${idx}`;
    const nome = (it.name || "").replace(/[\r\n;]+/g, " ").trim();
    const preco = formatPriceBR(it.price);
    const imagem = it.imgUrl || "";
    const row = [
      "", // id
      nome,
      "", // descricao
      preco,
      "", // estoque
      "", // categoria
      sku,
      "", // tamanhos
      "", // cores
      "", // sabores
      "", // estoque_variantes
      imagem
    ].map(v => String(v ?? "")).join(";");

    lines.push(row + "\n");

    // baixar imagem
    try {
      if (imagem && imagem.startsWith("http")) {
        const ext = imagem.includes(".png") ? "png" : "jpg";
        const imgPath = path.join(imgDir, `${sanitize(sku)}.${ext}`);
        // download simples via fetch no contexto do node (usando playwright request)
        // vamos reaproveitar o page para buscar
        const resp = await fetch(imagem);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(imgPath, buf);
        }
      }
    } catch {}

    idx++;
  }

  fs.writeFileSync(csvPath, lines.join(""), "utf8");

  await browser.close();
  return { totalItems: sliced.length };
}
