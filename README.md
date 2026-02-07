# NC Court of Appeals Digest

Automated weekly digest of NC Court of Appeals opinions. This program scrapes new opinions from the NC Courts website, generates AI-powered summaries, and emails a digest every Friday at 5 PM.

## Features

- **Automated Scraping**: Fetches opinions from https://appellate.nccourts.org/opinion-filings/?c=coa
- **Weekly Filtering**: Only processes opinions filed within the past 7 days (no duplicates)
- **PDF Parsing**: Extracts text and metadata from opinion PDFs
- **AI Summaries**: Generates professional legal summaries using Claude
- **Dissent/Concurrence**: Includes summaries of dissenting and concurring opinions
- **Email Delivery**: Sends formatted HTML/text digests to configurable recipients
- **Scheduled Execution**: Runs automatically every Friday at 5 PM Eastern

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd nccoa-digest

# Install dependencies
npm install

# Install Playwright browser
npm run install-browsers
```

## Configuration

Create a `.env` file or set environment variables:

```bash
# Required: Anthropic API key for AI summaries
ANTHROPIC_API_KEY=your-api-key-here

# Required: SMTP settings for email delivery
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com

# Optional: Email recipients (comma-separated)
# Default: mswigley@wardandsmith.com
EMAIL_RECIPIENTS=recipient1@example.com,recipient2@example.com

# Optional: Browser settings
BROWSER_HEADLESS=true
```

### Gmail Setup

If using Gmail, you'll need to create an App Password:
1. Go to your Google Account settings
2. Navigate to Security > 2-Step Verification
3. At the bottom, click "App passwords"
4. Generate a new app password for "Mail"
5. Use this password as `SMTP_PASS`

## Usage

### Start the Scheduler

```bash
npm start
```

The program will run continuously and send digests every Friday at 5 PM Eastern Time.

### Run Immediately (Testing)

```bash
npm run cron
```

This runs the digest job immediately without waiting for the scheduled time.

### Send Test Email

```bash
npm run test-email
```

Sends a test email to verify your SMTP configuration.

## Managing Recipients

### Default Recipients

The default recipient list is defined in `src/config.js`:

```javascript
recipients: ['mswigley@wardandsmith.com'],
```

### Adding Recipients via Environment Variable

```bash
EMAIL_RECIPIENTS="user1@example.com,user2@example.com,user3@example.com" npm start
```

### Adding Recipients Programmatically

```javascript
import { addRecipient, removeRecipient, getRecipients } from './src/config.js';

// Add a new recipient
addRecipient('newuser@example.com');

// Remove a recipient
removeRecipient('olduser@example.com');

// Get all recipients
const recipients = getRecipients();
```

## Summary Format

Summaries follow this format:

```
**Case Name** (Mon. DD, YYYY) (Case Type – Subject) (AUTHOR, OtherJudge, DissenterName dissenting):
Summary of the case including key issue, holding, and reasoning.
```

Example:

```
**State v. Johnson** (Jan. 13, 2026) (Criminal – Sentencing) (TYSON, Murphy, Arrowood dissenting):
Defendant Johnson appealed his conviction for first-degree murder, arguing the trial court erred in
denying his motion to suppress. The Court of Appeals affirmed, holding that the officer had reasonable
suspicion to conduct the traffic stop based on the observed traffic violation, and the subsequent search
was justified under the automobile exception.
```

## Project Structure

```
nccoa-digest/
├── src/
│   ├── index.js          # Main entry point
│   ├── config.js         # Configuration management
│   ├── scraper.js        # Web scraping with Puppeteer
│   ├── pdfParser.js      # PDF text extraction
│   ├── summaryGenerator.js # AI summary generation
│   ├── emailSender.js    # Email delivery
│   └── scheduler.js      # Cron scheduling
├── Dockerfile            # Docker configuration for Render
├── package.json
└── README.md
```

## Render Deployment

This program is designed to run on Render as a cron job with Docker.

### How Duplicates Are Avoided

The program only processes opinions filed within the **past 7 days**. This means:
- Each weekly run automatically filters to only recent opinions
- No persistent storage is required
- No duplicate opinions across digest emails

### Environment Variables for Render

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key for Claude |
| `SMTP_USER` | Yes | SMTP username (email address) |
| `SMTP_PASS` | Yes | SMTP password or app password |
| `SMTP_HOST` | No | SMTP server (default: smtp.gmail.com) |
| `SMTP_PORT` | No | SMTP port (default: 587) |
| `EMAIL_RECIPIENTS` | No | Comma-separated list of recipients |

### Schedule

The render.yaml configures the cron job to run at 10 PM UTC (5 PM Eastern) every Friday:
```
schedule: "0 22 * * 5"
```

## Troubleshooting

### Website Blocks Requests

The scraper uses Puppeteer with a realistic browser user agent. If still blocked:
- Try running with `BROWSER_HEADLESS=false` to debug
- The site may have rate limiting; add delays between requests

### PDF Parsing Fails

Some PDFs may be scanned images. The parser extracts text from text-based PDFs only.

### Email Not Sending

1. Verify SMTP credentials with `npm run test-email`
2. Check spam folder
3. For Gmail, ensure App Password is used
4. Check firewall/network allows SMTP connections

### No New Opinions Found

- The program only includes opinions filed within the past 7 days
- If no opinions were filed recently, the digest will be empty
- Verify the website is accessible at https://appellate.nccourts.org/opinion-filings/?c=coa

## Difference from NC Supreme Court Digest

This program is specifically for the **NC Court of Appeals** and uses:
- URL: `https://appellate.nccourts.org/opinion-filings/?c=coa`
- Database: `./data/coa-opinions.db`

The companion program for NC Supreme Court opinions uses:
- URL: `https://appellate.nccourts.org/opinion-filings/` (default, Supreme Court)
- Database: `./data/opinions.db`

## License

MIT
