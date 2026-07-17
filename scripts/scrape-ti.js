/**
 * Transponder Island category scraper (Playwright).
 *
 * Usage:
 *   npm run scrape:ti
 *   TI_CATEGORY_URL="https://transponderisland.com/shop/category/by-make-japanese-subaru-198" npm run scrape:ti
 *
 * First-time setup (if Chromium is missing):
 *   npx playwright install chromium
 */

require("dotenv").config()

const fs = require("fs")
const path = require("path")
const { chromium } = require("playwright")

// Default: Subaru category (112 items). Override with TI_CATEGORY_URL.
const DEFAULT_CATEGORY_URL =
  "https://transponderisland.com/shop/category/by-make-japanese-subaru-198"
const CATEGORY_URL = (process.env.TI_CATEGORY_URL || DEFAULT_CATEGORY_URL).trim()
const OUTPUT_PATH = path.join(__dirname, "ti_catalog.json")
const MAX_PAGES = Number(process.env.TI_MAX_PAGES || 50)
const DETAIL_CONCURRENCY = Number(process.env.TI_DETAIL_CONCURRENCY || 3)
const HEADLESS = process.env.TI_HEADED !== "1"

/** Checkpoint logger so failures show exactly where the run stopped. */
function checkpoint(step, detail = "") {
  const stamp = new Date().toISOString()
  const suffix = detail ? ` — ${detail}` : ""
  console.log(`[${stamp}] [TI-SCRAPE] ${step}${suffix}`)
}

/** Normalize absolute https image URLs; prefer larger Odoo product sizes. */
function cleanImageUrl(raw, baseUrl) {
  if (!raw || typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null
  try {
    const absolute = new URL(trimmed, baseUrl).toString()
    // Listing thumbs are often image_128 — bump to image_512 when possible.
    return absolute.replace(/\/image_128(\b|\/|\?)/, "/image_512$1")
  } catch {
    return null
  }
}

/** Pull FCC-style IDs from title / description text (avoid SKUs / OE part #s). */
function extractFccId(text) {
  if (!text) return null
  const blob = String(text)

  // Explicit "FCC ID # HYQ14AHK" / "FCC ID: M3N-..." labels first.
  const labeled = blob.match(
    /FCC\s*ID\s*#?\s*:?\s*([A-Z0-9]{3,}(?:-[A-Z0-9]+)?)/i
  )
  if (labeled?.[1]) {
    const id = labeled[1].toUpperCase()
    if (
      id.length >= 5 &&
      !/^(TIK|TIT|ILC|SKU|REPLACES|WITH|NOT|OE)\b/.test(id) &&
      !/^\d{3}-\d{4}$/.test(id)
    ) {
      return id
    }
  }

  // Unlabeled title hits — only known remote/fob FCC families.
  const compact = blob.match(
    /\b((?:HYQ|CWTWB?|CWT|KR5|M3N|GQ4|G8D|OUCG|TAK|HUF|NHVWB?|NHV|ALF)[A-Z0-9]{4,})\b/i
  )
  if (compact?.[1]) return compact[1].toUpperCase()

  // Hyphenated FCC grant IDs only (e.g. M3N-5WY7997, 2AOKM-SB1) — not OE parts.
  const hyphen = blob.match(/\b((?:M3N|2AOKM|GQ4|KR5)-[A-Z0-9]{2,})\b/i)
  if (hyphen?.[1]) return hyphen[1].toUpperCase()

  return null
}

/** Pull "315 MHz" / "434 MHz" style frequencies. */
function extractFrequency(text) {
  if (!text) return null
  const match = String(text).match(/(\d{3})\s*MHz/i)
  return match ? `${match[1]} MHz` : null
}

/** Primary TI SKU from "SKU: TIK-SUB-37" (or slug fallback). */
function extractPrimarySku(text, productUrl) {
  const labeled = String(text || "").match(/SKU:\s*([A-Z0-9-]+)/i)
  if (labeled?.[1]) return labeled[1].toUpperCase()

  const tik = String(text || "").match(/\b(TIK-[A-Z]+-\d+[A-Z]?)\b/i)
  if (tik?.[1]) return tik[1].toUpperCase()

  // Slug often starts with tik-sub-37-...
  const fromUrl = String(productUrl || "").match(/\/shop\/(tik-[a-z0-9-]+?)(?:-\d{3,})?(?:\?|$)/i)
  if (fromUrl?.[1]) {
    const slugSku = fromUrl[1].match(/^(tik-[a-z]+-\d+[a-z]?)/i)
    if (slugSku?.[1]) return slugSku[1].toUpperCase()
  }
  return null
}

/** Cross-reference TI SKU when listed separately (e.g. C/R TI → TIK-SUB-37A). */
function extractCrossRefTiSku(text) {
  const match = String(text || "").match(
    /C\/R\s*TI[^\n]*?\b(TIK-[A-Z0-9-]+)\b/i
  )
  return match?.[1] ? match[1].toUpperCase() : null
}

/** True when the page is a login wall instead of a shop listing/detail. */
function looksLikeLoginWall(pageText, hasProductGrid) {
  const text = String(pageText || "").toLowerCase()
  if (hasProductGrid) return false
  const hasPasswordField = text.includes("password") && text.includes("login")
  const blocked = text.includes("sign in to continue") || text.includes("please log in")
  return hasPasswordField && blocked
}

/** Collect product cards from the current category listing page. */
async function collectListingCards(page, pageUrl) {
  return page.evaluate((base) => {
    const roots = [...document.querySelectorAll("[data-publish]")]
    const cards = []
    for (const el of roots) {
      const link = el.querySelector('a[href*="/shop/"]')
      if (!link?.href) continue
      const img = el.querySelector("img")
      const text = (el.innerText || "").replace(/\s+/g, " ").trim()
      // Title is the first line before "Login to see price" / "Add to Cart".
      const title = text
        .replace(/\s*Login to see price.*$/i, "")
        .replace(/\s*Add to Cart.*$/i, "")
        .trim()
      cards.push({
        productUrl: link.href.split("?")[0],
        title: title || null,
        imageUrl: img?.src || img?.getAttribute("data-src") || null,
        listingText: text,
      })
    }
    // Deduplicate by product URL.
    const seen = new Set()
    return cards.filter((card) => {
      const key = card.productUrl
      if (seen.has(key)) return false
      seen.add(key)
      // Keep relative→absolute resolution available for callers.
      try {
        card.productUrl = new URL(card.productUrl, base).toString()
      } catch {
        /* keep as-is */
      }
      return true
    })
  }, pageUrl)
}

/** Discover pagination URLs for the category (page/2, page/3, …). */
async function discoverCategoryPages(page, firstUrl) {
  const links = await page.evaluate(() => {
    return [...document.querySelectorAll("ul.pagination a, .o_wsale_products_pager a")]
      .map((a) => a.href)
      .filter(Boolean)
  })

  const pages = new Set([firstUrl.split("?")[0].replace(/\/page\/\d+\/?$/, "")])
  for (const href of links) {
    try {
      const u = new URL(href)
      pages.add(u.origin + u.pathname.replace(/\/$/, ""))
    } catch {
      /* ignore bad href */
    }
  }

  // Ensure numbered pages 1..N when pager only exposes a few links.
  const base = firstUrl.split("?")[0].replace(/\/page\/\d+\/?$/, "")
  const maxPageNum = Math.max(
    1,
    ...[...pages]
      .map((u) => {
        const m = u.match(/\/page\/(\d+)/)
        return m ? Number(m[1]) : 1
      })
      .filter((n) => Number.isFinite(n))
  )

  const ordered = [base]
  for (let n = 2; n <= Math.min(maxPageNum, MAX_PAGES); n += 1) {
    ordered.push(`${base}/page/${n}`)
  }
  return ordered
}

/** Open a product detail page and extract structured fields. */
async function scrapeProductDetail(context, listingCard) {
  const page = await context.newPage()
  try {
    checkpoint("DETAIL_GOTO", listingCard.productUrl)
    const response = await page.goto(listingCard.productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    if (!response || !response.ok()) {
      checkpoint(
        "DETAIL_HTTP_FAIL",
        `${listingCard.productUrl} status=${response?.status() ?? "none"}`
      )
      return {
        title: listingCard.title,
        tiSku: extractPrimarySku(listingCard.listingText, listingCard.productUrl),
        crossRefTiSku: null,
        fccId: extractFccId(`${listingCard.title} ${listingCard.listingText}`),
        frequency: extractFrequency(listingCard.listingText),
        imageUrl: cleanImageUrl(listingCard.imageUrl, listingCard.productUrl),
        productUrl: listingCard.productUrl,
        scrapeError: `HTTP ${response?.status() ?? "none"}`,
      }
    }

    await page.waitForTimeout(800)

    const detail = await page.evaluate(() => {
      const h1 = document.querySelector("h1")?.innerText?.trim() || null
      const bodyText = document.body?.innerText || ""
      const img =
        document.querySelector(
          ".o_wsale_product_images img, #o-carousel-product img, img[src*='product.template'], img[src*='product.product']"
        )?.src || null
      const hasLoginForm = Boolean(
        document.querySelector("form.oe_login_form input[name='password']")
      )
      return { h1, bodyText, img, hasLoginForm, title: document.title }
    })

    if (detail.hasLoginForm && !detail.h1) {
      checkpoint("DETAIL_LOGIN_WALL", listingCard.productUrl)
      return {
        title: listingCard.title,
        tiSku: null,
        crossRefTiSku: null,
        fccId: null,
        frequency: null,
        imageUrl: cleanImageUrl(listingCard.imageUrl, listingCard.productUrl),
        productUrl: listingCard.productUrl,
        scrapeError: "login_wall",
      }
    }

    const combinedText = [detail.h1, detail.bodyText, listingCard.title, listingCard.listingText]
      .filter(Boolean)
      .join("\n")

    return {
      title: detail.h1 || listingCard.title || detail.title || null,
      tiSku: extractPrimarySku(combinedText, listingCard.productUrl),
      crossRefTiSku: extractCrossRefTiSku(combinedText),
      fccId: extractFccId(combinedText),
      frequency: extractFrequency(combinedText),
      imageUrl:
        cleanImageUrl(detail.img, listingCard.productUrl) ||
        cleanImageUrl(listingCard.imageUrl, listingCard.productUrl),
      productUrl: listingCard.productUrl,
    }
  } catch (err) {
    checkpoint("DETAIL_ERROR", `${listingCard.productUrl} → ${err.message}`)
    return {
      title: listingCard.title,
      tiSku: extractPrimarySku(listingCard.listingText, listingCard.productUrl),
      crossRefTiSku: null,
      fccId: extractFccId(`${listingCard.title} ${listingCard.listingText}`),
      frequency: extractFrequency(listingCard.listingText),
      imageUrl: cleanImageUrl(listingCard.imageUrl, listingCard.productUrl),
      productUrl: listingCard.productUrl,
      scrapeError: err.message,
    }
  } finally {
    await page.close().catch(() => {})
  }
}

/** Run detail scrapes with a small concurrency pool. */
async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function runOne() {
    while (nextIndex < items.length) {
      const i = nextIndex
      nextIndex += 1
      results[i] = await worker(items[i], i)
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne())
  await Promise.all(runners)
  return results
}

async function main() {
  checkpoint("START", `category=${CATEGORY_URL}`)
  checkpoint("OUTPUT", OUTPUT_PATH)

  let browser
  try {
    checkpoint("BROWSER_LAUNCH", `headless=${HEADLESS}`)
    browser = await chromium.launch({ headless: HEADLESS })
  } catch (err) {
    checkpoint("BROWSER_LAUNCH_FAIL", err.message)
    console.error(
      "\nChromium is missing. Run this once, then retry:\n  npx playwright install chromium\n"
    )
    process.exit(1)
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  })
  const page = await context.newPage()

  try {
    checkpoint("CATEGORY_GOTO", CATEGORY_URL)
    const response = await page.goto(CATEGORY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    })
    checkpoint("CATEGORY_HTTP", `status=${response?.status() ?? "none"}`)

    if (!response || response.status() >= 400) {
      checkpoint("CATEGORY_FAIL", "Category page returned an error status")
      throw new Error(`Category page HTTP ${response?.status()}`)
    }

    checkpoint("CATEGORY_WAIT_GRID", "waiting for [data-publish] product cards")
    try {
      await page.waitForSelector("[data-publish]", { timeout: 30000 })
    } catch {
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "")
      const login = looksLikeLoginWall(bodyText, false)
      checkpoint(
        "CATEGORY_GRID_MISSING",
        login
          ? "Product grid not found — page looks like a LOGIN WALL"
          : "Product grid not found — layout may have changed"
      )
      console.error("Page snippet:\n", bodyText.slice(0, 600))
      throw new Error("Product grid did not load")
    }

    await page.waitForTimeout(1000)

    const categoryPages = await discoverCategoryPages(page, CATEGORY_URL)
    checkpoint("CATEGORY_PAGES", `${categoryPages.length} page(s) to crawl`)

    const listingCards = []
    const seenUrls = new Set()

    for (let i = 0; i < categoryPages.length; i += 1) {
      const pageUrl = categoryPages[i]
      checkpoint("CATEGORY_PAGE", `${i + 1}/${categoryPages.length} ${pageUrl}`)
      if (i > 0) {
        const pageResp = await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        })
        if (!pageResp || pageResp.status() >= 400) {
          checkpoint("CATEGORY_PAGE_SKIP", `HTTP ${pageResp?.status()}`)
          continue
        }
        try {
          await page.waitForSelector("[data-publish]", { timeout: 20000 })
        } catch {
          checkpoint("CATEGORY_PAGE_EMPTY", pageUrl)
          continue
        }
        await page.waitForTimeout(600)
      }

      const cards = await collectListingCards(page, pageUrl)
      checkpoint("CATEGORY_PAGE_CARDS", `${cards.length} card(s) on this page`)
      for (const card of cards) {
        if (seenUrls.has(card.productUrl)) continue
        seenUrls.add(card.productUrl)
        listingCards.push(card)
      }
    }

    if (listingCards.length === 0) {
      checkpoint("NO_PRODUCTS", "No product cards collected — aborting")
      throw new Error("No products found on category pages")
    }

    checkpoint("DETAIL_PASS_START", `${listingCards.length} product(s), concurrency=${DETAIL_CONCURRENCY}`)
    const catalog = await mapPool(listingCards, DETAIL_CONCURRENCY, (card) =>
      scrapeProductDetail(context, card)
    )

    // Stable sort by TI SKU then title.
    catalog.sort((a, b) => {
      const skuA = a.tiSku || ""
      const skuB = b.tiSku || ""
      if (skuA !== skuB) return skuA.localeCompare(skuB)
      return String(a.title || "").localeCompare(String(b.title || ""))
    })

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8")
    checkpoint("WRITE_OK", `${catalog.length} product(s) → ${OUTPUT_PATH}`)

    const withSku = catalog.filter((row) => row.tiSku).length
    const withFcc = catalog.filter((row) => row.fccId).length
    const withErr = catalog.filter((row) => row.scrapeError).length
    checkpoint(
      "SUMMARY",
      `total=${catalog.length} withSku=${withSku} withFcc=${withFcc} errors=${withErr}`
    )
  } finally {
    checkpoint("BROWSER_CLOSE")
    await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  checkpoint("FATAL", err.message)
  console.error(err)
  process.exit(1)
})
