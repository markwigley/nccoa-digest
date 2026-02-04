/**
 * Web scraper for NC Court of Appeals opinion filings
 * Uses Puppeteer to handle JavaScript-rendered content and popup links
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
 * Handles JavaScript popup links by extracting URLs from onclick handlers
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year being scraped
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>} Array of opinion objects
 */
async function scrapeOpinionsFromPage(page, year, reviewedUrls) {
  console.log(`Scraping Court of Appeals opinions for year ${year}...`);

  // Extract opinion data from the page
  // Look for elements with onclick handlers, data attributes, or href containing PDF paths
  const opinionData = await page.evaluate(() => {
    const results = [];

    // Method 1: Look for elements with onclick handlers containing opinion URLs
    // NC Courts uses viewOpinion("url") pattern with URLs like:
    // http://appellate.nccourts.org/opinions/?c=2&pdf=44825
    const clickableElements = document.querySelectorAll('[onclick]');
    for (const el of clickableElements) {
      const onclick = el.getAttribute('onclick') || '';
      // Look for viewOpinion(), window.open(), or any URL in onclick
      const urlMatch = onclick.match(/viewOpinion\s*\(\s*["']([^"']+)["']\s*\)/i) ||
                       onclick.match(/window\.open\s*\(\s*["']([^"']+)["']/i) ||
                       onclick.match(/["'](https?:\/\/[^"']+opinions[^"']+)["']/i) ||
                       onclick.match(/["']([^"']*\.pdf[^"']*)["']/i);
      if (urlMatch) {
        results.push({
          pdfUrl: urlMatch[1],
          text: el.textContent?.trim() || '',
          rowText: el.closest('tr')?.textContent?.trim() || el.parentElement?.textContent?.trim() || '',
          source: 'onclick'
        });
      }
    }

    // Method 2: Look for links with href containing PDF
    const pdfLinks = document.querySelectorAll('a[href*=".pdf"]');
    for (const el of pdfLinks) {
      results.push({
        pdfUrl: el.getAttribute('href'),
        text: el.textContent?.trim() || '',
        rowText: el.closest('tr')?.textContent?.trim() || el.parentElement?.textContent?.trim() || '',
        source: 'href'
      });
    }

    // Method 3: Look for links with href="javascript:" that might open PDFs
    const jsLinks = document.querySelectorAll('a[href^="javascript:"]');
    for (const el of jsLinks) {
      const href = el.getAttribute('href') || '';
      const pdfMatch = href.match(/['"]([^'"]*\.pdf[^'"]*)['"]/i);
      if (pdfMatch) {
        results.push({
          pdfUrl: pdfMatch[1],
          text: el.textContent?.trim() || '',
          rowText: el.closest('tr')?.textContent?.trim() || el.parentElement?.textContent?.trim() || '',
          source: 'javascript-href'
        });
      }
    }

    // Method 4: Look for data attributes that might contain PDF URLs
    const dataElements = document.querySelectorAll('[data-pdf], [data-url], [data-href], [data-file]');
    for (const el of dataElements) {
      const pdfUrl = el.getAttribute('data-pdf') || el.getAttribute('data-url') ||
                     el.getAttribute('data-href') || el.getAttribute('data-file');
      if (pdfUrl && pdfUrl.includes('.pdf')) {
        results.push({
          pdfUrl: pdfUrl,
          text: el.textContent?.trim() || '',
          rowText: el.closest('tr')?.textContent?.trim() || el.parentElement?.textContent?.trim() || '',
          source: 'data-attr'
        });
      }
    }

    // Method 5: Search for PDF URLs in all script tags
    const scripts = document.querySelectorAll('script');
    const pdfUrlPattern = /['"]([^'"]*opinions[^'"]*\.pdf)['"]/gi;
    for (const script of scripts) {
      const content = script.textContent || '';
      let match;
      while ((match = pdfUrlPattern.exec(content)) !== null) {
        results.push({
          pdfUrl: match[1],
          text: '',
          rowText: '',
          source: 'script'
        });
      }
    }

    // Method 6: Look in the raw HTML for PDF URLs (as a fallback)
    const htmlContent = document.body.innerHTML;
    const allPdfUrls = htmlContent.match(/['"](\/opinions\/[^'"]*\.pdf)['"]/gi) ||
                        htmlContent.match(/['"]([^'"]*appellate[^'"]*\.pdf)['"]/gi) ||
                        htmlContent.match(/['"]([^'"]*coa[^'"]*\.pdf)['"]/gi) || [];
    for (const match of allPdfUrls) {
      const url = match.replace(/['"]/g, '');
      if (!results.some(r => r.pdfUrl === url)) {
        results.push({
          pdfUrl: url,
          text: '',
          rowText: '',
          source: 'html-regex'
        });
      }
    }

    return results;
  });

  console.log(`Found ${opinionData.length} potential opinion entries from page`);

  // Debug: Log what we found
  if (opinionData.length > 0) {
    console.log('Sample opinion data found:', opinionData.slice(0, 5));
  } else {
    // Extra debugging if nothing found - dump page structure
    const debugInfo = await page.evaluate(() => {
      const body = document.body.innerHTML;
      return {
        hasPdfInHtml: body.includes('.pdf'),
        hasOnclick: document.querySelectorAll('[onclick]').length,
        hasJsHref: document.querySelectorAll('a[href^="javascript:"]').length,
        sampleText: document.body.innerText.substring(0, 2000),
        allOnclicks: Array.from(document.querySelectorAll('[onclick]')).slice(0, 10).map(el => ({
          onclick: el.getAttribute('onclick')?.substring(0, 200),
          text: el.textContent?.trim().substring(0, 50)
        }))
      };
    });
    console.log('Debug info:', JSON.stringify(debugInfo, null, 2));
  }

  const opinions = [];

  for (const data of opinionData) {
    try {
      if (!data.pdfUrl) continue;

      // Build full URL
      let fullUrl = data.pdfUrl;
      if (!fullUrl.startsWith('http')) {
        fullUrl = fullUrl.startsWith('/')
          ? `${config.nccourts.baseUrl}${fullUrl}`
          : `${config.nccourts.baseUrl}/${fullUrl}`;
      }

      // Skip if already reviewed
      if (reviewedUrls.has(fullUrl)) {
        console.log(`Skipping already reviewed: ${data.text || fullUrl}`);
        continue;
      }

      // Check if this is a published opinion (skip unpublished)
      const contextText = (data.rowText || data.text || '').toLowerCase();
      if (contextText.includes('unpublished')) {
        console.log(`Skipping unpublished opinion: ${data.text || fullUrl}`);
        continue;
      }

      const opinion = {
        caseName: data.text || 'Unknown',
        caseNumber: extractCaseNumber(data.rowText || data.text || ''),
        pdfUrl: fullUrl,
        filingDate: extractDateFromText(data.rowText || ''),
        court: 'NC Court of Appeals',
        year: year,
        published: true,
      };

      opinions.push(opinion);
      console.log(`Found new PUBLISHED opinion: ${opinion.caseName} - ${opinion.pdfUrl}`);

    } catch (err) {
      console.error('Error processing opinion data:', err.message);
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
