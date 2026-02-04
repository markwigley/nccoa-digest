/**
 * Web scraper for NC Court of Appeals opinion filings
 * Downloads the zip file of published opinions for more reliable PDF access
 */

import puppeteer from 'puppeteer';
import AdmZip from 'adm-zip';
import { config } from './config.js';
import { getReviewedPdfUrls } from './database.js';

/**
 * Fetch new opinions from the NC Court of Appeals website
 * Uses the "Zip File of Published Opinions" for reliable PDF access
 * @returns {Promise<Object[]>} Array of new opinion objects with PDF buffers
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
    page.setDefaultTimeout(60000);

    const currentYear = new Date().getFullYear();
    console.log(`Current year: ${currentYear}`);

    const reviewedUrls = getReviewedPdfUrls();
    console.log(`Already reviewed ${reviewedUrls.size} opinions`);

    // Navigate to the opinions page
    const yearUrl = `${config.nccourts.baseUrl}/opinion-filings/?c=coa&year=${currentYear}`;
    console.log(`Navigating to: ${yearUrl}`);

    await page.goto(yearUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('Waiting for page content to load...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    // Find the zip file link for published opinions
    const zipUrl = await page.evaluate(() => {
      // Look for link containing "Zip File" text
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        const text = link.textContent?.toLowerCase() || '';
        const href = link.getAttribute('href') || '';
        if ((text.includes('zip') && text.includes('published')) ||
            href.includes('.zip')) {
          return link.href;
        }
      }
      return null;
    });

    if (!zipUrl) {
      console.log('No zip file link found, falling back to individual opinion scraping...');
      return await scrapeIndividualOpinions(page, currentYear, reviewedUrls);
    }

    console.log(`Found zip file URL: ${zipUrl}`);

    // Download the zip file
    console.log('Downloading zip file of published opinions...');
    const zipBuffer = await downloadFile(page, zipUrl);

    if (!zipBuffer || zipBuffer.length === 0) {
      console.log('Failed to download zip file, falling back to individual scraping...');
      return await scrapeIndividualOpinions(page, currentYear, reviewedUrls);
    }

    console.log(`Downloaded zip file: ${zipBuffer.length} bytes`);

    // Extract PDFs from the zip file
    const opinions = await extractOpinionsFromZip(zipBuffer, currentYear, reviewedUrls);

    console.log(`Found ${opinions.length} new published opinions from zip file`);
    return opinions;

  } finally {
    await browser.close();
  }
}

/**
 * Download a file and return its buffer
 * @param {Page} page - Puppeteer page
 * @param {string} url - URL to download
 * @returns {Promise<Buffer>}
 */
async function downloadFile(page, url) {
  try {
    const response = await page.evaluate(async (downloadUrl) => {
      const resp = await fetch(downloadUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arrayBuffer = await resp.arrayBuffer();
      return Array.from(new Uint8Array(arrayBuffer));
    }, url);

    return Buffer.from(response);
  } catch (err) {
    console.error(`Error downloading file: ${err.message}`);
    return null;
  }
}

/**
 * Extract opinions from a zip file buffer
 * @param {Buffer} zipBuffer - Zip file buffer
 * @param {number} year - Year
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>}
 */
async function extractOpinionsFromZip(zipBuffer, year, reviewedUrls) {
  const opinions = [];

  try {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    console.log(`Zip file contains ${zipEntries.length} entries`);

    for (const entry of zipEntries) {
      const fileName = entry.entryName;

      // Skip non-PDF files and directories
      if (entry.isDirectory || !fileName.toLowerCase().endsWith('.pdf')) {
        continue;
      }

      // Skip unpublished opinions (if somehow included)
      if (fileName.toLowerCase().includes('unpublished')) {
        console.log(`Skipping unpublished: ${fileName}`);
        continue;
      }

      // Use filename as unique identifier for deduplication
      const pdfIdentifier = `zip://${year}/${fileName}`;
      if (reviewedUrls.has(pdfIdentifier)) {
        console.log(`Skipping already reviewed: ${fileName}`);
        continue;
      }

      // Extract case name from filename
      // Typical format: "Smith v. Jones.pdf" or "State v. Defendant.pdf"
      const caseName = fileName
        .replace(/\.pdf$/i, '')
        .replace(/_/g, ' ')
        .trim();

      const pdfBuffer = entry.getData();

      const opinion = {
        caseName: caseName,
        caseNumber: extractCaseNumberFromName(caseName),
        pdfUrl: pdfIdentifier,
        pdfBuffer: pdfBuffer,
        filingDate: new Date().toISOString().split('T')[0],
        court: 'NC Court of Appeals',
        year: year,
        published: true,
      };

      opinions.push(opinion);
      console.log(`Found published opinion: ${caseName}`);
    }
  } catch (err) {
    console.error(`Error extracting zip file: ${err.message}`);
  }

  return opinions;
}

/**
 * Fallback: Scrape individual opinions from the page
 * @param {Page} page - Puppeteer page
 * @param {number} year - Year
 * @param {Set<string>} reviewedUrls - Already reviewed URLs
 * @returns {Promise<Object[]>}
 */
async function scrapeIndividualOpinions(page, year, reviewedUrls) {
  console.log(`Scraping individual Court of Appeals opinions for year ${year}...`);

  const opinionData = await page.evaluate(() => {
    const results = [];

    // Look for viewOpinion() onclick handlers
    const clickableElements = document.querySelectorAll('[onclick]');
    for (const el of clickableElements) {
      const onclick = el.getAttribute('onclick') || '';
      const urlMatch = onclick.match(/viewOpinion\s*\(\s*["']([^"']+)["']\s*\)/i) ||
                       onclick.match(/window\.open\s*\(\s*["']([^"']+)["']/i) ||
                       onclick.match(/["'](https?:\/\/[^"']+opinions[^"']+)["']/i);
      if (urlMatch) {
        results.push({
          pdfUrl: urlMatch[1],
          text: el.textContent?.trim() || '',
          rowText: el.closest('tr')?.textContent?.trim() || el.parentElement?.textContent?.trim() || '',
        });
      }
    }

    return results;
  });

  console.log(`Found ${opinionData.length} opinion entries`);

  const opinions = [];

  for (const data of opinionData) {
    if (!data.pdfUrl) continue;

    // Skip if already reviewed
    if (reviewedUrls.has(data.pdfUrl)) {
      console.log(`Skipping already reviewed: ${data.text || data.pdfUrl}`);
      continue;
    }

    // Skip unpublished opinions
    const contextText = (data.rowText || data.text || '').toLowerCase();
    if (contextText.includes('unpublished')) {
      console.log(`Skipping unpublished: ${data.text || data.pdfUrl}`);
      continue;
    }

    const opinion = {
      caseName: data.text || 'Unknown',
      caseNumber: extractCaseNumber(data.rowText || data.text || ''),
      pdfUrl: data.pdfUrl,
      filingDate: extractDateFromText(data.rowText || ''),
      court: 'NC Court of Appeals',
      year: year,
      published: true,
    };

    opinions.push(opinion);
    console.log(`Found published opinion: ${opinion.caseName}`);
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
    /\((\d{2,4}-\d+)[^)]*\)/i,  // (24-1035 - Published)
    /\b(\d{2,4}[-\s]?COA[-\s]?\d+)\b/i,
    /\b(COA\d{2}-\d+)\b/i,
    /\b(\d{2,4}[-\s]?(?:COA|CRS|CVS|SP|PA|SPA|WC)[-\s]?\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return '';
}

/**
 * Extract case number from filename
 * @param {string} name - Case name/filename
 * @returns {string}
 */
function extractCaseNumberFromName(name) {
  const match = name.match(/(\d{2,4}-\d+)/);
  return match ? match[1] : '';
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
  // If we already have a buffer (from zip extraction), this won't be called
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
