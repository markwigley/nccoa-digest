#!/usr/bin/env node

/**
 * NC Court of Appeals Digest - Main Entry Point
 *
 * Automatically fetches new opinions from NC Court of Appeals, generates summaries,
 * and emails a weekly digest every Friday at 5 PM.
 *
 * Usage:
 *   npm start           - Start the scheduler (runs every Friday at 5 PM)
 *   npm run dev         - Run immediately (--run-now flag)
 *   npm run test        - Send a test email (--test-email flag)
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY   - Required for AI summary generation
 *   SMTP_HOST           - SMTP server hostname (default: smtp.gmail.com)
 *   SMTP_PORT           - SMTP server port (default: 587)
 *   SMTP_USER           - SMTP username/email
 *   SMTP_PASS           - SMTP password or app password
 *   SMTP_FROM           - From email address
 *   EMAIL_RECIPIENTS    - Comma-separated list of recipients
 */

import { config, getRecipients } from './config.js';
import { fetchNewOpinions, downloadPdf } from './scraper.js';
import { extractOpinionInfo } from './pdfParser.js';
import { generateSummary } from './summaryGenerator.js';
import { sendWeeklyDigest, sendTestEmail, verifyEmailConfig } from './emailSender.js';
import { startScheduler, getNextRunTime, getTimeUntilNextRun } from './scheduler.js';

/**
 * Check if a date string is within the past N days
 * @param {string} dateStr - Date string (e.g., "Jan. 15, 2026")
 * @param {number} days - Number of days to look back (default: 7)
 * @returns {boolean}
 */
function isWithinPastDays(dateStr, days = 7) {
  if (!dateStr) return false;

  try {
    const opinionDate = new Date(dateStr);
    if (isNaN(opinionDate.getTime())) return false;

    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

    return opinionDate >= cutoffDate;
  } catch {
    return false;
  }
}

/**
 * Main digest generation job
 * Fetches new opinions, generates summaries, and sends email
 */
async function runDigestJob() {
  console.log('\n' + '='.repeat(60));
  console.log('NC Court of Appeals Digest - Starting job');
  console.log(new Date().toISOString());
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Fetch opinions from the website
    console.log('\nStep 1: Fetching opinions from NC Court of Appeals...');
    const allOpinions = await fetchNewOpinions();

    if (allOpinions.length === 0) {
      console.log('\nNo opinions found. Nothing to process.');
      return;
    }

    console.log(`\nFound ${allOpinions.length} opinion(s) in the zip file`);

    // Step 2: Extract info and filter to only opinions from the past 7 days
    console.log('\nStep 2: Processing opinions and filtering by date...');
    const recentOpinions = [];

    for (let i = 0; i < allOpinions.length; i++) {
      const opinion = allOpinions[i];
      console.log(`\n[${i + 1}/${allOpinions.length}] Checking: ${opinion.caseName || opinion.pdfUrl}`);

      try {
        // Get PDF buffer - either already have it (from zip) or need to download
        let pdfBuffer;
        if (opinion.pdfBuffer) {
          console.log('  Using PDF from zip file...');
          pdfBuffer = opinion.pdfBuffer;
        } else {
          console.log('  Downloading PDF...');
          pdfBuffer = await downloadPdf(opinion.pdfUrl);
        }

        // Extract information from PDF
        console.log('  Extracting opinion information...');
        const opinionInfo = await extractOpinionInfo(pdfBuffer);

        // Merge extracted info with scraped info
        const fullOpinionInfo = {
          ...opinion,
          ...opinionInfo,
          caseName: opinionInfo.caseName || opinion.caseName,
          opinionDate: opinionInfo.opinionDate || opinion.filingDate,
        };

        // Check if opinion is from the past 7 days
        if (!isWithinPastDays(fullOpinionInfo.opinionDate, 7)) {
          console.log(`  ⏭ Skipping: Filed ${fullOpinionInfo.opinionDate} (older than 7 days)`);
          continue;
        }

        console.log(`  ✓ Recent opinion: Filed ${fullOpinionInfo.opinionDate}`);
        recentOpinions.push(fullOpinionInfo);

      } catch (err) {
        console.error(`  ✗ Error processing opinion: ${err.message}`);
      }
    }

    if (recentOpinions.length === 0) {
      console.log('\nNo opinions from the past 7 days. Nothing to send.');
      return;
    }

    console.log(`\nFound ${recentOpinions.length} opinion(s) from the past 7 days`);

    // Step 3: Generate summaries for recent opinions
    console.log('\nStep 3: Generating summaries...');
    const processedOpinions = [];

    for (let i = 0; i < recentOpinions.length; i++) {
      const opinion = recentOpinions[i];
      console.log(`\n[${i + 1}/${recentOpinions.length}] Summarizing: ${opinion.caseName}`);

      try {
        const summary = await generateSummary(opinion);
        processedOpinions.push({
          ...opinion,
          summary,
        });
        console.log('  ✓ Summary generated');

        // Rate limiting between API calls
        if (i < recentOpinions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.error(`  ✗ Error generating summary: ${err.message}`);
        processedOpinions.push({
          ...opinion,
          summary: `[Summary generation failed: ${err.message}]`,
        });
      }
    }

    // Step 4: Send email digest
    if (processedOpinions.length > 0) {
      console.log('\nStep 4: Sending email digest...');
      console.log(`Recipients: ${getRecipients().join(', ')}`);

      try {
        await sendWeeklyDigest(processedOpinions, new Date());
        console.log('✓ Email sent successfully');
      } catch (err) {
        console.error('✗ Failed to send email:', err.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Digest job completed');
    console.log(`Processed ${processedOpinions.length} opinion(s) from the past week`);
    console.log('='.repeat(60) + '\n');

  } catch (err) {
    console.error('\nDigest job failed:', err);
    throw err;
  }
}

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    runNow: args.includes('--run-now'),
    testEmail: args.includes('--test-email'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
NC Court of Appeals Digest - Automated Opinion Summaries

Usage:
  node src/index.js [options]

Options:
  --run-now      Run the digest job immediately instead of waiting for schedule
  --test-email   Send a test email to verify configuration
  --help, -h     Show this help message

Environment Variables:
  ANTHROPIC_API_KEY   API key for Claude (required for summaries)
  SMTP_HOST           SMTP server hostname (default: smtp.gmail.com)
  SMTP_PORT           SMTP server port (default: 587)
  SMTP_USER           SMTP username/email (required for email)
  SMTP_PASS           SMTP password (required for email)
  SMTP_FROM           From email address (defaults to SMTP_USER)
  EMAIL_RECIPIENTS    Comma-separated email recipients
  BROWSER_HEADLESS    Set to 'false' for visible browser (default: true)

Examples:
  # Start the scheduler (runs every Friday at 5 PM)
  npm start

  # Run immediately for testing
  npm run dev

  # Send a test email
  npm run test

  # Add additional recipients
  EMAIL_RECIPIENTS="user1@example.com,user2@example.com" npm start
`);
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log('\n' + '╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' NC Court of Appeals Digest'.padEnd(58) + '║');
  console.log('║' + ' Automated Opinion Summaries'.padEnd(58) + '║');
  console.log('╚' + '═'.repeat(58) + '╝\n');

  // Show configuration
  console.log('Configuration:');
  console.log(`  Recipients: ${getRecipients().join(', ')}`);
  console.log(`  Anthropic API: ${config.anthropic.apiKey ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`  SMTP: ${config.email.smtp.auth.user ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`  Filter: Only opinions from the past 7 days`);
  console.log('');

  // Test email mode
  if (args.testEmail) {
    console.log('Sending test email...\n');
    try {
      await verifyEmailConfig();
      await sendTestEmail();
      console.log('\n✓ Test email sent successfully!');
    } catch (err) {
      console.error('\n✗ Test email failed:', err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Run immediately mode
  if (args.runNow) {
    console.log('Running digest job immediately...\n');
    try {
      await runDigestJob();
      console.log('\n✓ Digest job completed!');
    } catch (err) {
      console.error('\n✗ Digest job failed:', err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: Start scheduler
  console.log('Starting scheduler...');
  console.log(`Schedule: Every Friday at 5:00 PM Eastern Time`);
  console.log(`Next run: ${getNextRunTime()?.toLocaleString()}`);
  console.log(`Time until next run: ${getTimeUntilNextRun()}`);
  console.log('\nPress Ctrl+C to stop\n');

  startScheduler(runDigestJob);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    process.exit(0);
  });
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
