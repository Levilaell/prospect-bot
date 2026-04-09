// Takes mobile screenshots via Puppeteer and sends to Claude Vision for visual analysis

import puppeteer from 'puppeteer';
import Anthropic from '@anthropic-ai/sdk';
import { runBatch } from '../lib/utils.js';
import { VISUAL_SYSTEM } from '../lib/prompts.js';

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2 };
const NAV_TIMEOUT_MS = 15000;

async function screenshotSite(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
    return screenshot;
  } finally {
    await page.close();
  }
}

async function analyzeScreenshot(client, imageBuffer) {
  const base64 = imageBuffer.toString('base64');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: VISUAL_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          {
            type: 'text',
            text: 'Analyze this mobile screenshot of a small business website. Return only the JSON.',
          },
        ],
      },
    ],
  });

  const text = response.content[0]?.text?.trim() ?? '{}';
  // Extract JSON even if wrapped in markdown code block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { visual_score: null, visual_notes: [] };

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    visual_score: typeof parsed.visual_score === 'number' ? parsed.visual_score : null,
    visual_notes: Array.isArray(parsed.visual_notes) ? parsed.visual_notes : [],
  };
}

export async function visualAnalysis(leads) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const total = leads.length;
    let done = 0;

    const results = await runBatch(
      leads,
      async (lead) => {
        done++;
        process.stdout.write(
          `\r  👁️   Visual analysis [${done}/${total}] ${lead.business_name}...`.padEnd(72),
        );

        try {
          const screenshot = await screenshotSite(browser, lead.website);
          const { visual_score, visual_notes } = await analyzeScreenshot(client, screenshot);
          return { ...lead, visual_score, visual_notes };
        } catch {
          return { ...lead, visual_score: null, visual_notes: [] };
        }
      },
      5,
    );

    process.stdout.write('\n');
    return results;
  } finally {
    if (browser) await browser.close();
  }
}
