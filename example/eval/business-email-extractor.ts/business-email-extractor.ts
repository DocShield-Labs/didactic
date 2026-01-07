/**
 * Business Email Information Extractor
 * 
 * Extracts structured business information from email text.
 * Uses llmCompare for fields where exact matching doesn't work
 * (company names, payment terms, service descriptions).
 * 
 * Run with:
 * ANTHROPIC_API_KEY=your_key npx tsx example/eval/business-email-extractor/business-email-extractor.ts
 */

import { evaluate, fn, llmCompare, exact } from '../../../src/index.js';
import 'dotenv/config';

interface EmailInput {
  emailText: string;
}

interface ExtractedInfo {
  companyName: string;
  contactPerson: string;
  serviceDescription: string;
  paymentTerms: string;
}

// Mock extractor that simulates an LLM extraction with slight variations
const mockExtractor = fn<EmailInput, ExtractedInfo>({
  fn: async (input) => {
    // Simulate extraction with common variations:
    // - Company suffixes differ (Inc vs Incorporated)
    // - Payment terms phrased differently but same meaning
    // - Service descriptions paraphrased
    if (input.emailText.includes('Acme Corporation')) {
      return {
        companyName: 'Acme Corp.',  // Abbreviated
        contactPerson: 'John Smith',
        serviceDescription: 'Website development and design services',  // Slightly rephrased
        paymentTerms: 'Payment due within 30 days',  // Different phrasing
      };
    }

    if (input.emailText.includes('TechStart')) {
      return {
        companyName: 'TechStart LLC',  // Added LLC
        contactPerson: 'Sarah Johnson',
        serviceDescription: 'Cloud infrastructure setup',  // Exact match
        paymentTerms: 'Net 45',  // Exact match
      };
    }

    throw new Error('Unknown email');
  },
});

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  console.log('Testing Business Email Extractor with llmCompare\n');

  const result = await evaluate({
    systemPrompt: 'Extract business information from emails',
    executor: mockExtractor,
    comparators: {
      companyName: llmCompare({
        apiKey,
        systemPrompt: "Compare the two company names and determine if they refer to the same company. Consider variations in abbreviations (Corp vs Corporation), legal suffixes (LLC, Inc), and formatting. Focus on whether they identify the same business entity."
      }),  // Names have variations
      contactPerson: exact,  // Names should be exact
      serviceDescription: llmCompare({ apiKey }),  // Descriptions can be paraphrased
      paymentTerms: llmCompare({ apiKey }),  // Terms have different phrasings
    },
    testCases: [
      {
        input: {
          emailText: `
            From: John Smith <john@acme-corp.com>
            Subject: Project Proposal
            
            Dear Team,
            
            Acme Corporation is interested in your web development and design services.
            Our standard terms are Net 30 days.
            
            Best regards,
            John Smith
          `,
        },
        expected: {
          companyName: 'Acme Corporation',  // Extracted as "Acme Corp."
          contactPerson: 'John Smith',  // Exact match
          serviceDescription: 'Web development and design services',  // Paraphrased
          paymentTerms: 'Net 30',  // Different phrasing: "Payment due within 30 days"
        },
      },
      {
        input: {
          emailText: `
            From: Sarah Johnson <sarah@techstart.io>
            Subject: Infrastructure Setup
            
            Hi,
            
            TechStart needs cloud infrastructure setup.
            Payment terms: Net 45
            
            Thanks,
            Sarah Johnson
          `,
        },
        expected: {
          companyName: 'TechStart',  // Extracted as "TechStart LLC"
          contactPerson: 'Sarah Johnson',  // Exact match
          serviceDescription: 'Cloud infrastructure setup',  // Exact match
          paymentTerms: 'Net 45',  // Exact match
        },
      },
    ],
  });

  // Print results
  console.log('='.repeat(70));
  console.log(`RESULTS: ${result.passed}/${result.total} tests passed`);
  console.log('='.repeat(70) + '\n');

  result.testCases.forEach((testResult, idx) => {
    const status = testResult.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`\nTest ${idx + 1}: ${status} (${testResult.passedFields}/${testResult.totalFields} fields)`);
    console.log('-'.repeat(70));

    // Show each field
    Object.entries(testResult.fields).forEach(([field, fieldResult]) => {
      const fieldStatus = fieldResult.passed ? '✅' : '❌';
      console.log(`\n${fieldStatus} ${field}:`);
      console.log(`  Expected: ${JSON.stringify(testResult.expected[field as keyof ExtractedInfo])}`);
      console.log(`  Actual:   ${JSON.stringify(testResult.actual?.[field as keyof ExtractedInfo])}`);

      if (fieldResult.rationale) {
        console.log(`  Rationale: ${fieldResult.rationale}`);
      }

      if (fieldResult.cost) {
        console.log(`  Cost: $${fieldResult.cost.toFixed(4)}`);
      }
    });
  });

  console.log('\n' + '='.repeat(70));
  console.log(`Total comparator cost: $${result.comparatorCost.toFixed(4)}`);
  console.log(`Overall accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
  console.log('='.repeat(70) + '\n');

  process.exit(result.passed === result.total ? 0 : 1);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

