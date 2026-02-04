/**
 * Web scraper for NC Court of Appeals opinion filings
 * Uses Puppeteer to handle JavaScript-rendered content
 */

import puppeteer from 'puppeteer';
import { config } from './config.js';
import { getReviewedPdfUrls } from './database.js';

/**
 * Fetch new opinions from the NC Court of Appeals website
 * @returns {Promise<Object[]>} Array of new opinion objects
 */
export async function fetchNewOpinions() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    page.setDefaultTimeout(60000); // 60 second timeout

    // Get the current year
    const currentYear = new Date().getFullYear();
    console.log(`Current year: ${currentYear}`);

    // Get already reviewed opinion URLs
    const reviewedUrls = getReviewedPdfUrls();
    console.log(`Already reviewed ${reviewedUrls.size} opinions`);

    // Navigate directly to the year-specific URL
    // URL format: https://appellate.nccourts.org/opinion-filings/?c=coa&year=2026
    const yearUrl = `${config.nccourts.baseUrl}/opinion-filings/?c=coa&year=${currentYear}`;
    console.log(`Navigating to: ${yearUrl}`);

    await page.goto(yearUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for page to fully render
    console.log('Waiting for page content to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Debug: Log page title and URL
    const pageTitle = await page.title();
    const currentUrl = page.url();
    console.log(`Page title: ${pageTitle}`);
    console.log(`Current URL: ${currentUrl}`);

    // Debug: Get page content length
    const content = await page.content();
    console.log(`Page content length: ${content.length} characters`);

    // Fetch opinions from the page
    const opinions = await scrapeOpinionsFromPage(page, currentYear, reviewedUrls);

    console.log(`Found ${opinions.length} new opinions total`);
    return opinions;

  } finally {
    await browser.close();
  }
}

/**
 * Scrape opinions from the current page
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year being scraped
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>} Array of opinion objects
 */
async function scrapeOpinionsFromPage(page, year, reviewedUrls) {
  console.log(`Scraping Court of Appeals opinions for year ${year}...`);

  const opinions = [];

  // Try multiple selectors to find opinion links
  // The NC Courts site may use different structures
  const selectors = [
    'a[href*=".pdf"]',
    'a[href*="opinions"]',
    'table a',
    '.opinion-link',
    'td a',
    'a[href*="coa"]',
  ];

  let allLinks = [];

  for (const selector of selectors) {
    try {
      const links = await page.$$(selector);
      if (links.length > 0) {
        console.log(`Selector "${selector}" found ${links.length} elements`);
        allLinks = allLinks.concat(links);
      }
    } catch (err) {
      // Selector not found, continue
    }
  }

  // Deduplicate links by href
  const seenHrefs = new Set();
  const uniqueLinks = [];

  for (const link of allLinks) {
    try {
      const href = await page.evaluate(el => el.getAttribute('href'), link);
      if (href && !seenHrefs.has(href)) {
        seenHrefs.add(href);
        uniqueLinks.push(link);
      }
    } catch (err) {
      // Skip problematic links
    }
  }

  console.log(`Found ${uniqueLinks.length} unique links to process`);

  // Debug: Log all hrefs found
  const allHrefs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => a.href).slice(0, 20);
  });
  console.log('Sample of links found on page:', allHrefs);

  for (const link of uniqueLinks) {
    try {
      const href = await page.evaluate(el => el.getAttribute('href'), link);
      const text = await page.evaluate(el => el.textContent, link);

      if (!href) continue;

      // Only process PDF links (opinions are PDFs)
      if (!href.toLowerCase().includes('.pdf')) continue;

      const fullUrl = href.startsWith('http') ? href : `${config.nccourts.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;

      if (reviewedUrls.has(fullUrl)) {
        console.log(`Skipping already reviewed: ${text?.trim() || fullUrl}`);
        continue;
      }

      // Extract case info from link text or surrounding context
      const parentText = await page.evaluate(el => {
        const row = el.closest('tr');
        if (row) return row.textContent;
        const parent = el.parentElement;
        return parent ? parent.textContent : el.textContent;
      }, link);

      const opinion = {
        caseName: text?.trim() || 'Unknown',
        caseNumber: extractCaseNumber(parentText || text || ''),
        pdfUrl: fullUrl,
        filingDate: extractDateFromText(parentText || ''),
        court: 'NC Court of Appeals',
        year: year,
      };

      opinions.push(opinion);
      console.log(`Found new opinion: ${opinion.caseName} - ${opinion.pdfUrl}`);

    } catch (err) {
      console.error('Error processing link:', err.message);
    }
  }

  return opinions;
}

/**
 * Extract case number from text
 * @param {string} text - Text to search
 * @returns {string}
 */
function extractCaseNumber(text) {
  // Common NC Court of Appeals case number patterns
  const patterns = [
    /\b(\d{2,4}[-\s]?COA[-\s]?\d+)\b/i,
    /\b(COA\d{2}-\d+)\b/i,
    /\b(\d{2,4}[-\s]?(?:COA|CRS|CVS|SP|PA|SPA|WC)[-\s]?\d+)\b/i,
    /\b(No\.\s*\d+[-A-Z]+\d*)\b/i,
    /\b(\d{2}[A-Z]{2,3}\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return '';
}

/**
 * Extract date from text
 * @param {string} text - Text to search
 * @returns {string|null}
 */
function extractDateFromText(text) {
  const dateMatch = text?.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\w+\s+\d{1,2},?\s+\d{4})/);
  return dateMatch ? dateMatch[0] : null;
}

/**
 * Download a PDF and return its buffer
 * @param {string} url - PDF URL
 * @returns {Promise<Buffer>}
 */
export async function downloadPdf(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: config.browser.timeout,
    });

    if (!response) {
      throw new Error('No response received');
    }

    const buffer = await response.buffer();
    return buffer;

  } finally {
    await browser.close();
  }
}
