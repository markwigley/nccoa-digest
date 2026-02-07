/**
 * Summary generator using Anthropic Claude API
 * Generates NC Court of Appeals opinion summaries in the specified legal digest style
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

let client = null;

/**
 * Initialize the Anthropic client
 */
function getClient() {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

/**
 * Generate a summary for a court opinion
 * @param {Object} opinionInfo - Extracted opinion information
 * @returns {Promise<string>} Generated summary
 */
export async function generateSummary(opinionInfo) {
  const anthropic = getClient();

  const prompt = buildPrompt(opinionInfo);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract text from response
  const summary = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return summary.trim();
}

/**
 * Build the prompt for summary generation
 * @param {Object} opinionInfo - Opinion information
 * @returns {string} Formatted prompt
 */
function buildPrompt(opinionInfo) {
  // Build dissent/concurrence sections if they exist
  let separateOpinionsSection = '';

  if (opinionInfo.hasDissent && opinionInfo.dissentContent) {
    separateOpinionsSection += `\n\nDISSENTING OPINION TEXT:\n${opinionInfo.dissentContent}`;
  }

  if (opinionInfo.hasConcurrence && opinionInfo.concurrenceContent) {
    separateOpinionsSection += `\n\nCONCURRING OPINION TEXT:\n${opinionInfo.concurrenceContent}`;
  }

  // Build instructions about dissent/concurrence
  let dissentInstructions = '';
  if (opinionInfo.hasDissent || opinionInfo.hasConcurrence) {
    dissentInstructions = `
8. IMPORTANT - DISSENTS AND CONCURRENCES: If there is a dissenting or concurring opinion:
   - Note it in the judge parenthetical (e.g., "King dissenting" or "Smith concurring")
   - After summarizing the majority opinion, add 1-3 sentences summarizing the key points of the dissent/concurrence
   - Format: "Judge [Name] dissented, arguing that..." or "In a concurrence, Judge [Name] wrote that..."`;
  }

  return `You are a legal analyst creating concise summaries of NC Court of Appeals opinions for a weekly digest sent to attorneys. Generate a summary in the exact style shown in the examples below.

IMPORTANT FORMATTING REQUIREMENTS:
1. Start with the case name in bold: **Case Name** (e.g., **Smith v. Jones** or **State v. Defendant**)
   - CRITICAL: Always use the actual party names (e.g., "Advisor Law, LLC v. Holland"), NOT the case number (e.g., "24-1035")
   - Extract the case name from the opinion text - it's usually near the top (e.g., "ADVISOR LAW, LLC v. HOLLAND")
   - For criminal cases, format as "State v. [Defendant's Last Name]"
2. Follow with a date parenthetical using the FILED DATE shown at the top of the opinion (NOT today's date): (Mon. DD, YYYY)
3. Include case type/subject in parentheses: (Civil – Employment) or (Criminal – Sentencing)
4. Include judge names in parentheses with the author in CAPS, others in regular case, and note any dissents/concurrences
5. Write 2-4 sentences summarizing: the key issue, the court's holding, and the reasoning
6. Keep the tone professional and informative
7. Use legal terminology appropriately${dissentInstructions}

EXAMPLE SUMMARIES:

**White v. Warden** (Jan. 13, 2026) (Civil – First Step Act) (NIEMEYER & Wilkinson, King dissenting): In a 2-1 decision, the Court held that prisoner White wasn't entitled to First Step Act time credits for three days spent in a transfer center because he didn't actually participate in any programming during that period—the statute requires earning credits through "successful participation," not mere presence. Judge King dissented, arguing the government waived its participation argument and that the majority's new theory lacked factual support and conflicted with BOP policies awarding credits based on "earning status."

**Figueroa v. Butterball, LLC** (Jan. 14, 2026) (Civil – Employment) (BENJAMIN, Richardson, Rushing): A turkey loader challenged his employer's wage practices under the Fair Labor Standards Act and the North Carolina Wage and Hour Act. The Court of Appeals affirmed summary judgment for Butterball, finding no genuine dispute in the record that Figueroa was a piece-rate employee (not hourly) based on his signed offer letter stating he'd be paid "a load rate of $10.80." The Court then went on to hold that Butterball had properly calculated overtime under FLSA regulations for piece-rate workers and rejected Figueroa's claims that hours were improperly shifted between workweeks.

**State v. Johnson** (Jan. 31, 2026) (Criminal – Sentencing) (GREGORY, Diaz, Keenan, Diaz dissenting): Defendant Johnson challenged his 36-month supervised release revocation sentence as plainly unreasonable, arguing the trial court failed to adequately explain why it imposed the statutory maximum despite his claims of mitigating circumstances. The Court of Appeals agreed and vacated, holding that when a court imposes an upward departure from the advisory guidelines range, it must provide a "more significant justification" and meaningfully address the defendant's nonfrivolous mitigation arguments—which the trial court failed to do.

**Martinez v. City Council** (Feb. 1, 2026) (Civil – Zoning) (THOMPSON, Lee, Park concurring): The Court affirmed the trial court's denial of a variance request, finding that the city council properly applied the hardship standard. Judge Park filed a concurrence emphasizing that while agreeing with the result, the majority's broad language about deference to municipal bodies should not be read to limit future judicial review of arbitrary zoning decisions.

NOW GENERATE A SUMMARY FOR THIS NC COURT OF APPEALS OPINION:

Case Name: ${opinionInfo.caseName || 'Unknown'}
FILED DATE (from "Filed [date]" at top of opinion): ${opinionInfo.opinionDate || 'Unknown'}
Case Type: ${opinionInfo.caseType || 'Unknown'}
Judges: ${formatJudges(opinionInfo.judges)}
Has Dissent: ${opinionInfo.hasDissent ? 'Yes' : 'No'}
Has Concurrence: ${opinionInfo.hasConcurrence ? 'Yes' : 'No'}
Court: NC Court of Appeals

MAJORITY OPINION TEXT (first several pages):
${opinionInfo.firstPageContent}${separateOpinionsSection}

---

Generate only the summary paragraph, nothing else. Start with the case name in bold (extract from the opinion text above - look for "X v. Y" pattern near the top). Do NOT use a case number like "${opinionInfo.caseName}" if it looks like a number - always use the actual party names.${opinionInfo.hasDissent || opinionInfo.hasConcurrence ? ' IMPORTANT: Include a summary of any dissent or concurrence at the end of your summary.' : ''}`;
}

/**
 * Format judges information for the prompt
 * @param {Object} judges - Judge information
 * @returns {string}
 */
function formatJudges(judges) {
  if (!judges) return 'Unknown';

  const parts = [];
  if (judges.author) parts.push(`Author: ${judges.author}`);
  if (judges.panel?.length) parts.push(`Panel: ${judges.panel.join(', ')}`);
  if (judges.dissenting?.length) parts.push(`Dissenting: ${judges.dissenting.join(', ')}`);
  if (judges.concurring?.length) parts.push(`Concurring: ${judges.concurring.join(', ')}`);

  return parts.length > 0 ? parts.join('; ') : 'Unknown';
}

/**
 * Generate summaries for multiple opinions
 * @param {Object[]} opinions - Array of opinion info objects
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Object[]>} Opinions with summaries added
 */
export async function generateSummaries(opinions, onProgress) {
  const results = [];

  for (let i = 0; i < opinions.length; i++) {
    const opinion = opinions[i];

    if (onProgress) {
      onProgress(i + 1, opinions.length, opinion.caseName);
    }

    try {
      console.log(`Generating summary for: ${opinion.caseName || opinion.pdfUrl}`);
      const summary = await generateSummary(opinion);
      results.push({
        ...opinion,
        summary,
      });

      // Rate limiting - wait between requests
      if (i < opinions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`Error generating summary for ${opinion.caseName}:`, err.message);
      results.push({
        ...opinion,
        summary: `[Summary generation failed: ${err.message}]`,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Format the final digest email content
 * @param {Object[]} opinions - Opinions with summaries
 * @param {Date} digestDate - Date of the digest
 * @returns {string} Formatted digest content
 */
export function formatDigest(opinions, digestDate) {
  const dateStr = digestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let content = `# NC Court of Appeals Weekly Digest\n`;
  content += `${dateStr} — ${opinions.length} new opinion(s) this week.\n\n`;

  for (const opinion of opinions) {
    content += `${opinion.summary}\n\n`;
    if (opinion.pdfUrl) {
      content += `[View Full Opinion (PDF)](${opinion.pdfUrl})\n\n`;
    }
    content += '---\n\n';
  }

  return content;
}

/**
 * Format digest as plain text (for email fallback)
 * @param {Object[]} opinions - Opinions with summaries
 * @param {Date} digestDate - Date of the digest
 * @returns {string} Plain text digest
 */
export function formatDigestPlainText(opinions, digestDate) {
  const dateStr = digestDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let content = `NC COURT OF APPEALS WEEKLY DIGEST\n`;
  content += `${dateStr} — ${opinions.length} new opinion(s) this week.\n`;
  content += '='.repeat(60) + '\n\n';

  for (const opinion of opinions) {
    // Remove markdown bold markers for plain text
    const plainSummary = opinion.summary.replace(/\*\*/g, '');
    content += `${plainSummary}\n\n`;
    if (opinion.pdfUrl) {
      content += `View Full Opinion: ${opinion.pdfUrl}\n\n`;
    }
    content += '-'.repeat(60) + '\n\n';
  }

  return content;
}
